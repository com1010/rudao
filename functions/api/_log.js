/**
 * Shared archive helpers — Cloudflare KV, binding name CHAT_LOG
 * ------------------------------------------------------------
 * Keeps a private, author-only record of what readers ask and what the
 * site answers, so Tony can read the conversations later. Files starting
 * with "_" are not routed by Pages, so this module has no public URL.
 *
 * BINDING: create a KV namespace and bind it to the Pages project as
 * CHAT_LOG (Settings -> Bindings -> KV namespace -> name it CHAT_LOG).
 * Without the binding every call here is a silent no-op and the chat
 * keeps working untouched.
 *
 * PRIVACY: only the question, the answer, the model, the country code
 * and the latency are stored. No IP address, no cookie, no browser id.
 * Entries expire after RETENTION_DAYS. Readers are told in the panel
 * that conversations may be kept for the author to read.
 */

export const RETENTION_DAYS = 180;
const TTL_SECONDS = RETENTION_DAYS * 24 * 60 * 60;
const MAX_ANSWER = 6000;
const MAX_QUESTION = 2000;
const MAX_FIELD = 4000;

export function kv(env) {
  const b = env && env.CHAT_LOG;
  return b && typeof b.put === 'function' && typeof b.list === 'function' ? b : null;
}

function stamp() {
  return new Date().toISOString();
}

function keyFor(kind, iso) {
  const rand = Math.random().toString(36).slice(2, 8);
  return kind + ':' + iso + ':' + rand;
}

async function put(env, kind, payload) {
  const store = kv(env);
  if (!store) return false;
  const t = payload.t || stamp();
  try {
    await store.put(keyFor(kind, t), JSON.stringify(Object.assign({ t, kind }, payload)), {
      expirationTtl: TTL_SECONDS
    });
    return true;
  } catch (err) {
    /* Logging must never break the thing it observes. */
    return false;
  }
}

/* Push the write off the response path: the reader gets the answer at
   once, the archive catches up a moment later. */
function background(context, promise) {
  try {
    if (context && typeof context.waitUntil === 'function') context.waitUntil(promise);
  } catch (err) {
    /* ignore */
  }
}

export function archiveChat(context, turns, result, provider, startedAt) {
  const env = context && context.env;
  if (!kv(env)) return;
  const list = Array.isArray(turns) ? turns : [];
  let asked = '';
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] && list[i].role === 'user') { asked = list[i].content; break; }
  }
  const cf = (context.request && context.request.cf) || {};
  const payload = {
    q: String(asked || '').slice(0, MAX_QUESTION),
    a: String((result && result.reply) || '').slice(0, MAX_ANSWER),
    provider: provider || '',
    model: (result && result.model) || '',
    ms: startedAt ? Date.now() - startedAt : null,
    country: cf.country || '',
    exchanges: list.filter((m) => m && m.role === 'user').length
  };
  background(context, put(env, 'chat', payload));
}

export function archiveMessage(context, fields) {
  const env = context && context.env;
  if (!kv(env)) return;
  const cf = (context.request && context.request.cf) || {};
  const clean = {};
  Object.keys(fields || {}).forEach((k) => {
    clean[k] = String(fields[k] == null ? '' : fields[k]).slice(0, MAX_FIELD);
  });
  clean.country = cf.country || '';
  background(context, put(env, 'msg', clean));
}

/* ---------- reading side ---------- */

export function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  return crypto.subtle.digest('SHA-256', data).then((buf) =>
    Array.prototype.map.call(new Uint8Array(buf), (b) => ('00' + b.toString(16)).slice(-2)).join('')
  );
}

/* Length-independent compare, so a wrong password leaks no timing hint. */
export function sameSecret(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (!x.length || !y.length) return false;
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    diff |= (x.charCodeAt(i % x.length) || 0) ^ (y.charCodeAt(i % y.length) || 0);
  }
  return diff === 0;
}

/* Newest first. KV lists ascending, so collect then reverse. Small site,
   so a couple of pages is plenty; the cap keeps a runaway key count from
   turning into a slow request. */
export async function listEntries(env, opts) {
  const store = kv(env);
  if (!store) return { entries: [], truncated: false };
  const days = (opts && opts.days) || 7;
  const kinds = (opts && opts.kinds) || ['chat', 'msg'];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const keys = [];
  let cursor;
  let truncated = true;
  for (let page = 0; page < 8; page += 1) {
    const res = await store.list({ limit: 1000, cursor });
    (res.keys || []).forEach((k) => keys.push(k.name));
    if (res.list_complete || !res.cursor) { truncated = false; break; }
    cursor = res.cursor;
  }
  const wanted = keys
    .filter((name) => kinds.indexOf(name.split(':')[0]) !== -1)
    .sort()
    .reverse();
  const fresh = [];
  for (const name of wanted) {
    const iso = name.split(':')[1] || '';
    const t = Date.parse(iso);
    if (!Number.isNaN(t) && t < cutoff) continue;
    fresh.push(name);
  }
  const entries = [];
  const batch = 20;
  for (let i = 0; i < fresh.length; i += batch) {
    const slice = fresh.slice(i, i + batch);
    const got = await Promise.all(slice.map((name) => store.get(name, 'json').catch(() => null)));
    got.forEach((v) => { if (v) entries.push(v); });
  }
  entries.sort((a, b) => String(b.t).localeCompare(String(a.t)));
  return { entries, truncated };
}
