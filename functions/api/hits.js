/**
 * Home page hit counter — plain-text total visits.
 * GET /api/hits  ->  {"count": 12345}
 *
 * Uses the CHAT_LOG KV namespace (same binding as the chat archive).
 * Read-modify-write increment: good enough for a page counter; a rare
 * race only loses one hit, never corrupts anything.
 *
 * If the KV binding is missing, returns count: null and the page simply
 * shows nothing (same graceful no-op behaviour as the chat logging).
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });

export async function onRequestGet({ env }) {
  const store = env && env.CHAT_LOG;
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    return json({ count: null });
  }
  const key = 'counter:home-hits';
  let n = 0;
  try {
    n = parseInt((await store.get(key)) || '0', 10) || 0;
  } catch (err) {
    /* fall through with 0 */
  }
  n += 1;
  try {
    await store.put(key, String(n));
    return json({ count: n });
  } catch (err) {
    /* write failed (e.g. daily write limit) — return last known count */
    return json({ count: n > 1 ? n - 1 : null });
  }
}
