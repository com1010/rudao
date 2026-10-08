/**
 * Cloudflare Pages Function — /api/blog
 * ------------------------------------------------------------
 * Public message board for the "Readers' Blog 读者博客" section
 * of RuDao.org / RuDao.us.
 *
 *   GET    /api/blog?limit=10&cursor=<ck>  → newest-first list of public posts
 *   POST   /api/blog                       → publish a message (no login required)
 *   PATCH  /api/blog?id=<id>               → rewrite your own message (≤10 min)
 *   DELETE /api/blog?id=<id>               → withdraw your own message (≤10 min)
 *
 * STORAGE — Cloudflare KV, bound to this Pages project as `BLOG_KV`
 *
 *   post:<inverted-ts>:<id>   → one JSON record per message
 *   rl:<ip-hash>              → rate-limit marker (60s TTL)
 *
 * AUTHOR WINDOW (withdraw / rewrite)
 *   POST answers with a one-off `token`. The browser keeps it in localStorage and
 *   sends it back as the `x-edit-token` header. Only the SHA-256 of that token is
 *   stored (`editHash`), and it is valid for EDIT_WINDOW_MS (10 minutes) after
 *   the post was created. Inside that window the author may rewrite (PATCH) or
 *   withdraw (DELETE) the message; afterwards it is permanent.
 *
 * ADMIN
 *   Add a Secret named BLOG_ADMIN_TOKEN and send it as the `x-admin-token`
 *   header on DELETE to remove any post at any time (moderation).
 *
 * If BLOG_KV is not bound yet the API answers 503 { error: 'not_configured' }
 * and the site shows a friendly "coming online" notice instead of failing.
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

/** How long the author may still withdraw or rewrite a message. */
const EDIT_WINDOW_MS = 10 * 60 * 1000;

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

function randomHex(bytes) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function makeId() {
  return randomHex(8);
}

/** Never hand the stored secret hash to the browser. */
function publicView(post) {
  const { editHash, ...rest } = post;
  return rest;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function hashToken(token, id) {
  return sha256Hex('rudao-blog-edit:' + id + ':' + token);
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

function withinWindow(post, now = Date.now()) {
  return !!post && Number.isFinite(post.createdAt) && now - post.createdAt <= EDIT_WINDOW_MS;
}

/** Find the KV key holding a given post id. */
async function findKey(env, id) {
  const listing = await env.BLOG_KV.list({ prefix: 'post:', limit: 1000 });
  const match = listing.keys.find((k) => k.name.endsWith(':' + id));
  return match ? match.name : null;
}

async function readPost(env, key) {
  const raw = await env.BLOG_KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/** Shared field validation for create + rewrite. */
function readFields(payload) {
  const name = clean(payload.name, 80);
  const location = clean(payload.location, 60);
  const message = clean(payload.message, 2000);
  let rating = parseInt(payload.rating, 10);
  if (!Number.isFinite(rating)) rating = 0;

  if (name.length < 2) return { error: 'name_required' };
  if (message.length < 5) return { error: 'message_required' };
  if (!(rating >= 1 && rating <= 5)) return { error: 'rating_invalid' };

  return { name, location, message, rating };
}

/* ---------------------------------------------------------------- GET ---- */

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.BLOG_KV) return json({ success: false, error: 'not_configured' }, 503);

  const url = new URL(request.url);

  // Password check for the hidden "Author Admin" panel. It only ever answers
  // whether the token that was sent is the right one — never whether one exists.
  if (url.searchParams.get('whoami') === 'admin') {
    const sent = request.headers.get('x-admin-token') || '';
    if (env.BLOG_ADMIN_TOKEN && sent === env.BLOG_ADMIN_TOKEN) {
      return json({ success: true, admin: true });
    }
    return json({ success: false, admin: false, error: 'unauthorized' }, 401);
  }

  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 1), 50);
  const cursor = url.searchParams.get('cursor') || undefined;

  const listing = await env.BLOG_KV.list({ prefix: 'post:', limit, cursor });
  const posts = [];
  for (const key of listing.keys) {
    const raw = await env.BLOG_KV.get(key.name);
    if (!raw) continue;
    try {
      const post = JSON.parse(raw);
      if (!post || post.hidden) continue;
      posts.push(publicView(post));
    } catch (err) {
      /* skip malformed records */
    }
  }

  return json({
    success: true,
    posts,
    editWindowMs: EDIT_WINDOW_MS,
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

  const fields = readFields(payload);
  if (fields.error) return json({ success: false, error: fields.error }, 400);

  // Light rate limit: one post per IP per minute.
  const ipHash = await hashIp(request);
  const rlKey = `rl:${ipHash}`;
  const recent = await env.BLOG_KV.get(rlKey);
  if (recent) return json({ success: false, error: 'rate_limited' }, 429);

  const createdAt = Date.now();
  const id = makeId();
  // The author's own key for the next 10 minutes. Only its hash is stored.
  const token = randomHex(16);

  const post = {
    id,
    name: fields.name,
    rating: fields.rating,
    message: fields.message,
    location: fields.location,
    createdAt,
    publishedAt: new Date(createdAt).toISOString(),
    editHash: await hashToken(token, id),
  };

  await env.BLOG_KV.put(postKey(id, createdAt), JSON.stringify(post));
  await env.BLOG_KV.put(rlKey, String(createdAt), { expirationTtl: 60 });

  return json(
    {
      success: true,
      post: publicView(post),
      token,
      editWindowMs: EDIT_WINDOW_MS,
      editableUntil: createdAt + EDIT_WINDOW_MS,
    },
    201
  );
}

/* -------------------------------------------------------------- PATCH ---- */

export async function onRequestPatch(context) {
  const { request, env } = context;

  if (!env.BLOG_KV) return json({ success: false, error: 'not_configured' }, 503);

  const id = clean(new URL(request.url).searchParams.get('id'), 32);
  if (!id) return json({ success: false, error: 'id_required' }, 400);

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ success: false, error: 'invalid_json' }, 400);
  }

  const key = await findKey(env, id);
  if (!key) return json({ success: false, error: 'not_found' }, 404);

  const post = await readPost(env, key);
  if (!post) return json({ success: false, error: 'not_found' }, 404);

  const token = request.headers.get('x-edit-token') || '';
  if (!token || !post.editHash || (await hashToken(token, id)) !== post.editHash) {
    return json({ success: false, error: 'unauthorized' }, 401);
  }
  if (!withinWindow(post)) {
    return json({ success: false, error: 'window_expired', editWindowMs: EDIT_WINDOW_MS }, 403);
  }

  const fields = readFields(payload);
  if (fields.error) return json({ success: false, error: fields.error }, 400);

  const updated = {
    ...post,
    name: fields.name,
    rating: fields.rating,
    message: fields.message,
    location: fields.location,
    updatedAt: Date.now(),
    revisions: (post.revisions || 0) + 1,
    // createdAt and the KV key stay put so the post keeps its place in the list
  };

  await env.BLOG_KV.put(key, JSON.stringify(updated));

  return json({ success: true, post: publicView(updated), updated: true }, 200);
}

/* ------------------------------------------------------------- DELETE ---- */

export async function onRequestDelete(context) {
  const { request, env } = context;

  if (!env.BLOG_KV) return json({ success: false, error: 'not_configured' }, 503);

  const id = clean(new URL(request.url).searchParams.get('id'), 32);
  if (!id) return json({ success: false, error: 'id_required' }, 400);

  const key = await findKey(env, id);
  if (!key) return json({ success: false, error: 'not_found' }, 404);

  const post = await readPost(env, key);

  const adminToken = request.headers.get('x-admin-token') || '';
  const isAdmin = !!env.BLOG_ADMIN_TOKEN && adminToken === env.BLOG_ADMIN_TOKEN;

  const editToken = request.headers.get('x-edit-token') || '';
  const ownsIt =
    !!editToken && !!post && !!post.editHash && (await hashToken(editToken, id)) === post.editHash;
  const isAuthor = ownsIt && withinWindow(post);

  if (!isAdmin && !isAuthor) {
    if (ownsIt) {
      return json({ success: false, error: 'window_expired', editWindowMs: EDIT_WINDOW_MS }, 403);
    }
    return json({ success: false, error: 'unauthorized' }, 401);
  }

  await env.BLOG_KV.delete(key);

  // The author may re-post straight away — release their one-post-per-minute lock.
  try {
    await env.BLOG_KV.delete(`rl:${await hashIp(request)}`);
  } catch (err) {
    /* non-fatal */
  }

  return json({ success: true, deleted: id, by: isAdmin ? 'admin' : 'author' });
}
