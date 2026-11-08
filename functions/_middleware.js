/**
 * Canonical host redirect for RuDao.org.
 *
 * RuDao.org is the primary domain: canonical tags, sitemap, llms.txt and
 * structured data all point at it. This middleware makes every other
 * hostname that reaches this project answer with a permanent redirect,
 * so search engines and AI crawlers consolidate on one origin instead of
 * splitting authority between rudao.org and rudao.us.
 *
 * Deliberately NOT redirected:
 *   - rudao.org     (the canonical host itself)
 *   - *.pages.dev   (production alias and preview deployments; these are
 *                    canonicalised by the <link rel="canonical"> tag, and
 *                    redirecting them would break preview builds)
 *
 * GET/HEAD answer 301 (cacheable, the conventional permanent move).
 * Anything else answers 308 so the method and body survive the hop.
 */

const CANONICAL_HOST = 'rudao.org';

/* Hosts that must fold into the canonical origin. */
const ALIASES = new Set([
  'rudao.us',
  'www.rudao.us',
  'www.rudao.org'
]);

export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const host = url.hostname.toLowerCase();

    if (ALIASES.has(host)) {
      const method = context.request.method;
      const status = method === 'GET' || method === 'HEAD' ? 301 : 308;
      return new Response(null, {
        status,
        headers: {
          Location: 'https://' + CANONICAL_HOST + url.pathname + url.search,
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }
  } catch (err) {
    /* A redirect must never take the site down: fall through to the asset. */
  }

  return context.next();
}
