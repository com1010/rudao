/**
 * Cloudflare Pages Function — GET /api/admin/logs
 * ------------------------------------------------------------
 * Author-only archive of reader conversations and contact-form
 * messages. Never linked from the site; the page that calls it lives at
 * /admin-chat-log and carries a noindex header.
 *
 * AUTH: send the admin password in the x-admin-key header. The password
 * is a Cloudflare secret named ADMIN_PASSWORD, compared against a hash,
 * so neither the value nor the length leaks through timing. If that
 * secret is missing the endpoint refuses everything — there is no
 * fallback password in this file.
 *
 *   GET /api/admin/logs?days=7            JSON
 *   GET /api/admin/logs?days=30&format=txt  downloadable text log
 *   GET /api/admin/logs?kind=chat         only questions and answers
 *   GET /api/admin/logs?kind=msg          only contact-form messages
 *
 * SETUP: add a KV namespace binding named CHAT_LOG and a secret named
 * ADMIN_PASSWORD, then Retry deployment (bindings only apply to a new
 * deployment).
 */

import { kv, sha256Hex, sameSecret, listEntries, RETENTION_DAYS } from '../_log.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
};
const TZ = 'Asia/Hong_Kong';
const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRIES = 8;

/* Failed-password throttle. Per isolate, which is enough to stop a
   scripted guessing loop without any extra infrastructure. Only failures
   count, so a working session is never locked out. */
const fails = new Map();

function lockedOut(ip) {
  const rec = fails.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.start > WINDOW_MS) { fails.delete(ip); return false; }
  return rec.n >= MAX_TRIES;
}

function noteFailure(ip) {
  const now = Date.now();
  const rec = fails.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) fails.set(ip, { start: now, n: 1 });
  else rec.n += 1;
}

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: JSON_HEADERS });
}

function hkTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(d);
  const pick = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return pick('year') + '-' + pick('month') + '-' + pick('day') + ' ' +
    pick('hour') + ':' + pick('minute') + ':' + pick('second');
}

function seconds(ms) {
  const n = Number(ms);
  if (!n || Number.isNaN(n)) return '';
  return (n / 1000).toFixed(1) + 's';
}

function block(entry, i) {
  const head = '[' + i + '] ' + hkTime(entry.t) + ' HKT  ';
  const lines = [];
  if (entry.kind === 'msg') {
    lines.push(head + 'MESSAGE' + (entry.country ? '  ' + entry.country : ''));
    lines.push('From:    ' + (entry.name || 'Anonymous') + (entry.email ? ' <' + entry.email + '>' : ''));
    if (entry.page) lines.push('Page:    ' + entry.page);
    if (entry.delivered) lines.push('Emailed: ' + entry.delivered);
    lines.push('');
    lines.push('Message: ' + (entry.message || '').replace(/\r?\n/g, '\n         '));
  } else {
    lines.push(head + 'CHAT' + (entry.country ? '  ' + entry.country : '') +
      (entry.provider ? '  ' + entry.provider : '') +
      (entry.model ? ' / ' + entry.model : '') +
      (entry.ms ? '  ' + seconds(entry.ms) : ''));
    lines.push('');
    lines.push('Q: ' + (entry.q || '').replace(/\r?\n/g, '\n   '));
    lines.push('');
    lines.push('A: ' + (entry.a || '').replace(/\r?\n/g, '\n   '));
  }
  return lines.join('\n');
}

function toText(entries, days, host) {
  const chats = entries.filter((e) => e.kind !== 'msg').length;
  const msgs = entries.length - chats;
  const rule = '='.repeat(72);
  const thin = '-'.repeat(72);
  const out = [
    'RuDao Chat Archive - admin copy',
    'Generated: ' + hkTime(new Date().toISOString()) + ' HKT',
    'Site: ' + host + '     Window: last ' + days + ' day' + (days === 1 ? '' : 's'),
    'Entries: ' + entries.length + '  (chat ' + chats + ', messages ' + msgs + ')',
    'Retention: ' + RETENTION_DAYS + ' days, stored in Cloudflare KV (CHAT_LOG)',
    'Privacy: question, answer, model, country and latency only - no IP address',
    rule,
    ''
  ];
  if (!entries.length) {
    out.push('(nothing archived in this window)', '');
  } else {
    entries.forEach((e, i) => {
      out.push(block(e, i + 1));
      out.push(thin, '');
    });
  }
  out.push('End of archive.');
  return out.join('\n');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const url = new URL(request.url);

  if (!env.ADMIN_PASSWORD) {
    return json({
      ok: false,
      code: 'not_configured',
      message: 'Set a secret named ADMIN_PASSWORD in the Pages project, then Retry deployment.'
    }, 503);
  }
  if (!kv(env)) {
    return json({
      ok: false,
      code: 'no_kv',
      message: 'Bind a KV namespace named CHAT_LOG, then Retry deployment.'
    }, 503);
  }

  if (lockedOut(ip)) {
    return json({ ok: false, code: 'locked', message: 'Too many attempts. Wait ten minutes.' }, 429);
  }

  const supplied = request.headers.get('x-admin-key') || '';
  const [a, b] = await Promise.all([
    sha256Hex(supplied),
    sha256Hex(env.ADMIN_PASSWORD)
  ]);
  if (!sameSecret(a, b)) {
    noteFailure(ip);
    return json({ ok: false, code: 'bad_password', message: 'Wrong password.' }, 401);
  }
  fails.delete(ip);

  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '7', 10) || 7));
  const kind = (url.searchParams.get('kind') || 'all').toLowerCase();
  const kinds = kind === 'chat' ? ['chat'] : kind === 'msg' ? ['msg'] : ['chat', 'msg'];

  const result = await listEntries(env, { days, kinds });
  const entries = result.entries;

  if (url.searchParams.get('format') === 'txt') {
    const body = toText(entries, days, url.hostname);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="rudao-chat-log-' + stamp + '.txt"',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive'
      }
    });
  }

  return json({
    ok: true,
    generated: new Date().toISOString(),
    host: url.hostname,
    days: days,
    kinds: kinds,
    count: entries.length,
    truncated: !!result.truncated,
    entries: entries
  }, 200);
}
