/**
 * Cloudflare Pages Function — /api/blog
 * ------------------------------------------------------------
 * Public message board for the "Readers' Blog 读者博客" section
 * of RuDao.org / RuDao.us.
 *
 *   GET  /api/blog?limit=10&cursor=<ck>   → newest-first list of public posts
 *   POST /api/blog                        → publish a message (no login required)
 *   DELETE /api/blog?id=<id>              → remove a post (author only, needs token)
 *
 * STORAGE — Cloudflare KV, bound to this Pages project as `BLOG_KV`
 *
 *   post:<inverted-ts>:<id>   → one JSON record per message
 *   rl:<ip-hash>              → rate-limit marker (60s TTL)
 *
 * SETUP (about 2 minutes, one time)
 *   Cloudflare dashboard → Workers & Pages → the RuDao Pages project
 *     → Settings → Bindings (or Functions → KV namespace bindings)
 *     → Add binding → KV namespace
 *         Variable name: BLOG_KV
 *         KV namespace:  create one, e.g. "rudao-readers-blog"
 *     → Save (production + preview). The next deployment picks it up.
 *
 *   Optional, to allow deleting posts from the browser console / curl:
 *     add a Secret named BLOG_ADMIN_TOKEN and send it as the
 *     `x-admin-token` header on DELETE.
 *
 * If BLOG_KV is not bound yet the API answers 503 { error: 'not_configured' }
 * and the site shows a friendly "coming online" notice instead of failing.
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/** Strip control characters and collapse whitespace. */
function clean(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** Cloudflare KV lists keys in lexicographic order — invert the timestamp so
 *  the newest post sorts first. */
function postKey(id, createdAt) {
  const inverted = String(9999999999999 - createdAt).padStart(13, '0');
  return `post:${inverted}:${id}`;
}

function makeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashIp(request) {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    'unknown';
  const data = new TextEncoder().encode('rudao-blog:' + ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

/* ---------------------------------------------------------------- GET ---- */

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.BLOG_KV) return json({ success: false, error: 'not_configured' }, 503);

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 1), 50);
  const cursor = url.searchParams.get('cursor') || undefined;

  const listing = await env.BLOG_KV.list({ prefix: 'post:', limit, cursor });
  const posts = [];
  for (const key of listing.keys) {
    const raw = await env.BLOG_KV.get(key.name);
    if (!raw) continue;
    try {
      const post = JSON.parse(raw);
      if (post && post.hidden) continue;
      posts.push(post);
    } catch (err) {
      /* skip malformed records */
    }
  }

  return json({
    success: true,
    posts,
    cursor: listing.list_complete ? null : listing.cursor,
    listComplete: !!listing.list_complete,
  });
}

/* --------------------------------------------------------------- POST ---- */

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.BLOG_KV) return json({ success: false, error: 'not_configured' }, 503);

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ success: false, error: 'invalid_json' }, 400);
  }

  // Honeypot — real readers never fill this in.
  if (payload.botcheck) return json({ success: true, skipped: 'spam' });

  const name = clean(payload.name, 80);
  const location = clean(payload.location, 60);
  const dateText = clean(payload.dateText, 40);
  const message = clean(payload.message, 2000);
  let rating = parseInt(payload.rating, 10);
  if (!Number.isFinite(rating)) rating = 0;

  if (name.length < 2) return json({ success: false, error: 'name_required' }, 400);
  if (message.length < 5) return json({ success: false, error: 'message_required' }, 400);
  if (!(rating >= 1 && rating <= 5)) return json({ success: false, error: 'rating_invalid' }, 400);

  // Light rate limit: one post per IP per minute.
  const ipHash = await hashIp(request);
  const rlKey = `rl:${ipHash}`;
  const recent = await env.BLOG_KV.get(rlKey);
  if (recent) return json({ success: false, error: 'rate_limited' }, 429);

  const createdAt = Date.now();
  const post = {
    id: makeId(),
    name,
    rating,
    message,
    location,
    dateText,
    createdAt,
    publishedAt: new Date(createdAt).toISOString(),
  };

  await env.BLOG_KV.put(postKey(post.id, createdAt), JSON.stringify(post));
  await env.BLOG_KV.put(rlKey, String(createdAt), { expirationTtl: 60 });

  return json({ success: true, post }, 201);
}

/* ------------------------------------------------------------- DELETE ---- */

export async function onRequestDelete(context) {
  const { request, env } = context;

  if (!env.BLOG_KV) return json({ success: false, error: 'not_configured' }, 503);

  const token = request.headers.get('x-admin-token') || '';
  if (!env.BLOG_ADMIN_TOKEN || token !== env.BLOG_ADMIN_TOKEN) {
    return json({ success: false, error: 'unauthorized' }, 401);
  }

  const id = clean(new URL(request.url).searchParams.get('id'), 32);
  if (!id) return json({ success: false, error: 'id_required' }, 400);

  // Locate the record (key embeds the inverted timestamp).
  const listing = await env.BLOG_KV.list({ prefix: 'post:', limit: 1000 });
  const match = listing.keys.find((k) => k.name.endsWith(':' + id));
  if (!match) return json({ success: false, error: 'not_found' }, 404);

  await env.BLOG_KV.delete(match.name);
  return json({ success: true, deleted: id });
}
