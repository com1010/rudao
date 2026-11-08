/**
 * Cloudflare Pages Function — POST /api/chat
 * ------------------------------------------------------------
 * Backs the "Ask RuDao AI" panel on rudao.us. The function grounds
 * the model on this site's own llms.txt (fetched from the same
 * origin, cached in the isolate) plus a fixed fact sheet, then
 * calls a free-tier LLM.
 *
 * PROVIDERS (first one configured wins)
 * 1. Google Gemini  — free tier, no card. Best quality/cost here.
 *      https://aistudio.google.com/apikey  ->  GEMINI_API_KEY
 * 2. Cloudflare Workers AI (binding "AI") — 10k neurons/day free.
 *      Dashboard -> Workers & Pages -> ru dao project -> Settings
 *      -> Functions -> AI bindings -> add binding named  AI
 * 3. Nothing configured -> HTTP 503 with a friendly message and the
 *      widget falls back to "email Tony" mode. The site never breaks.
 *
 * SECRETS (Cloudflare dashboard -> your Pages project -> Settings ->
 * Variables and Secrets; add as "Secret", then redeploy):
 *      GEMINI_API_KEY = AIza...
 *      CHAT_MODEL     = gemini-2.5-flash        (optional)
 *      CHAT_DAILY_CAP = 300                     (optional, per isolate)
 *
 * PRIVACY: no message content is logged or stored by this function.
 */

const MAX_TURNS = 12;          // messages kept from the client
const MAX_CHARS = 1200;        // per user message
const MAX_BODY = 20000;        // bytes of JSON body
const WINDOW_MS = 60 * 60 * 1000;
const PER_IP_PER_HOUR = 30;

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/* ------------------------------------------------------------------ */
/* Verified fact sheet — keeps the model from inventing book details. */
/* ------------------------------------------------------------------ */
const FACTS = `BOOK
Title: RuDao: Beyond The Art of War (儒道)
Author: Tony Tong 唐仪 (also written Tong Yi; website TonyTong.cc)
Co-editors: 葉匡時 (Yeh Kuang-shih), 張俊勇 (Cheung Chun-yung), 陳建榮 (Chen Chien-jung)
Editions: Heritage Edition, Scholar's Edition, Quiet Edition
Languages: bilingual — English body text with Chinese terms adjacent (mostly an English book)
Structure: six chapters plus front matter (Foreword, Purpose) and back matter (Afterword, Appendices, References)
  Ch.1 The Roots 源 — the natural pursuit of profit, the Shang origins of commerce
  Ch.2 What Is Ru+Dao 何谓儒+道 — a philosophy and ethics of business; Confucius; the Five Constants 五常 (仁义礼智信); the Eight Virtues 儒商八德
  Ch.3 Inner Sage, Outer King 内圣外王 — Ru + Dao; LaoZi 道家; SaiWeng ShiMa 塞翁失马 and Liao-Fan's Four Lessons 了凡四训 (Ch.3.3)
  Ch.4 Ru vs Strategists 儒家-兵家-竞合之道 — SunTzu and The Art of War; co-opetition 竞合; RuJiang 儒将
  Ch.5 RuShang Business Legends 儒商典范 — FanLi 范蠡, ZiGong 子贡, BaiGui 白圭; modern cases (Shibusawa, Inamori, Matsushita, Li Ka-shing, Lucio Tan, Buffett)
  Ch.6 RuDao in the AI Digital Age 数字时代
Thesis: the RuJiang 儒将 path goes beyond The Art of War — balanced profit and enduring partnerships, not zero-sum conquest.

CORE TERMS
RuDao 儒道 — the union of Confucian ethics (Ru) and Daoist flow (Dao) as one operating system: inner sage, outer king.
RuShang 儒商 — the Confucian merchant. Definition in eight characters: 以儒为体,以商为用 (Confucian principles as foundation, commerce as practice). Five dimensions: 见利思义, 诚信为本, 仁爱待客, 富而好德, 家国担当.
RuJiang 儒将 — the Confucian general: strategy with restraint, victory without humiliation.
Co-opetition 竞合 — competing and cooperating at the same time; the alternative to pure Art-of-War thinking.
义利合一 — unity of righteousness and profit; 义以生利,利以平民.
以商养道 — nurturing the Way through commerce (ZiGong).
智勇仁强 — wisdom, courage, benevolence, constancy (BaiGui's four tests).
君子富,好行其德 — the wealthy gentleman delights in practicing virtue (ShiJi 史记, 货殖列传).
Rule of the book on fate: 命由我作,福自己求 — outer circumstances shift, character decides (Ch.3.3).`;

const SYSTEM = `You are "RuDao AI", the reading assistant on rudao.us, the official site of the book RuDao: Beyond The Art of War by Tony Tong (唐仪).

HOW TO ANSWER
- You are a knowledgeable guide to the book and its ideas. You are NOT Tony Tong and you never pretend to be him. If asked for a personal opinion "from Tony", say you can explain what the book argues, and point to the contact form for a personal reply.
- Ground every factual claim in the CONTEXT or FACT SHEET below. If something is not covered, say plainly that the site does not say, and offer the relevant page (/guide, /faq) or Tony's email.
- Never invent quotations, page numbers, prices, ISBNs, publication dates, awards, or endorsements.
- Be concise: usually 90-180 words, short paragraphs, no bullet-point walls. Use at most one short quote.
- Keep Chinese terms next to their English sense, e.g. RuShang 儒商 (the Confucian merchant).
- Mirror the reader's language: English question -> English answer; Chinese question -> Simplified Chinese, keeping key terms in English.
- Tone: calm, precise, literary but plain. No hype, no emoji.
- You may suggest reading /guide (concept guide) and /faq (30 questions).

BOUNDARIES
- No legal, medical, tax or investment advice; say so in one line and suggest a qualified professional.
- No promises about delivery times, discounts, bulk pricing, speaking fees or manuscript review. Pricing and scheduling go through Tony: Tony@RuDao.org.
- Do not ask for or store personal data. Do not discuss other books' copyrighted text at length.
- If asked whether you are human: say you are an AI assistant trained on this site's material, and that Tony answers personally by email.

CONTEXT — official site summary (llms.txt):
`;

/* ------------------------------------------------------------------ */
/* Best-effort per-IP throttle (per isolate; good enough for a book site) */
/* ------------------------------------------------------------------ */
const hits = new Map();

function throttled(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) {
    hits.set(ip, { start: now, n: 1 });
    if (hits.size > 2000) hits.clear();
    return false;
  }
  rec.n += 1;
  return rec.n > PER_IP_PER_HOUR;
}

/* ------------------------------------------------------------------ */
/* Grounding document                                                  */
/* ------------------------------------------------------------------ */
let ctxCache = { text: '', at: 0 };

async function getContext(origin) {
  if (ctxCache.text && Date.now() - ctxCache.at < 3600 * 1000) return ctxCache.text;
  try {
    const res = await fetch(origin + '/llms.txt', {
      headers: { 'User-Agent': 'RuDao-Chat/1.0 (+https://rudao.us)' },
      cf: { cacheTtl: 3600, cacheEverything: true }
    });
    if (!res.ok) return '';
    let txt = await res.text();
    // Keep the prompt bounded; llms.txt starts with the most important facts.
    if (txt.length > 28000) txt = txt.slice(0, 28000);
    ctxCache = { text: txt, at: Date.now() };
    return txt;
  } catch (err) {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */
async function callGemini(env, systemPrompt, turns) {
  const model = env.CHAT_MODEL || 'gemini-2.5-flash';
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) +
    ':generateContent?key=' +
    encodeURIComponent(env.GEMINI_API_KEY);

  const contents = turns.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.6, maxOutputTokens: 700, topP: 0.9 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
      ]
    })
  });

  if (!res.ok) {
    const detail = await res.text();
    return { ok: false, status: res.status, detail: detail.slice(0, 400) };
  }
  const data = await res.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts) || [];
  const reply = parts.map((p) => p.text || '').join('').trim();
  if (!reply) return { ok: false, status: 502, detail: 'empty candidate' };
  return { ok: true, reply };
}

async function callWorkersAI(env, systemPrompt, turns) {
  const model = env.CHAT_MODEL || '@cf/meta/llama-3.1-8b-instruct';
  const messages = [{ role: 'system', content: systemPrompt }].concat(
    turns.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
  );
  const out = await env.AI.run(model, { messages, max_tokens: 700, temperature: 0.6 });
  const reply = (out && (out.response || out.result)) ? String(out.response || out.result).trim() : '';
  if (!reply) return { ok: false, status: 502, detail: 'empty response' };
  return { ok: true, reply };
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */
export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (throttled(ip)) {
    return json({ ok: false, code: 'rate_limited',
      message: 'Too many messages in one hour. Please email Tony@RuDao.org and he will reply personally.' }, 429);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, code: 'too_large' }, 413);

  let body;
  try { body = JSON.parse(raw); } catch (err) { return json({ ok: false, code: 'bad_json' }, 400); }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const turns = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS).trim() }))
    .filter((m) => m.content);

  if (!turns.length || turns[turns.length - 1].role !== 'user') {
    return json({ ok: false, code: 'no_question' }, 400);
  }

  const hasGemini = !!env.GEMINI_API_KEY;
  const hasWorkersAI = !!(env && env.AI && typeof env.AI.run === 'function');
  if (!hasGemini && !hasWorkersAI) {
    return json({
      ok: false,
      code: 'not_configured',
      message: 'RuDao AI is not connected yet. Tony answers personally: Tony@RuDao.org'
    }, 503);
  }

  const origin = new URL(request.url).origin;
  const site = await getContext(origin);
  const systemPrompt = SYSTEM + (site || '(site summary unavailable)') + '\n\nFACT SHEET:\n' + FACTS;

  let result;
  try {
    result = hasGemini
      ? await callGemini(env, systemPrompt, turns)
      : await callWorkersAI(env, systemPrompt, turns);
  } catch (err) {
    return json({ ok: false, code: 'upstream_error',
      message: 'The assistant is briefly unavailable. Please try again, or email Tony@RuDao.org.' }, 502);
  }

  if (!result.ok) {
    return json({
      ok: false,
      code: 'upstream_error',
      status: result.status,
      message: 'The assistant is briefly unavailable. Please try again, or email Tony@RuDao.org.'
    }, 502);
  }

  return json({ ok: true, reply: result.reply });
}

// Anything other than POST -> gentle 405 with the contact route.
export async function onRequestGet() {
  return json({ ok: false, code: 'method_not_allowed',
    message: 'POST a JSON body: {"messages":[{"role":"user","content":"..."}]}' }, 405);
}
