/**
 * Cloudflare Pages Function — POST /api/chat
 * ------------------------------------------------------------
 * Backs the "Ask RuDao AI" panel on rudao.org. The function grounds
 * the model on this site's own llms.txt (fetched from the same
 * origin, cached in the isolate) plus a fixed fact sheet, then
 * calls a free-tier LLM.
 *
 * PROVIDERS — tried in the order given by AI_ORDER (default below:
 * paid key first, free Worker AI as the safety net). Any provider that
 * is not configured is skipped silently.
 *
 *   compat    Any OpenAI-compatible endpoint. Currently DeepSeek
 *             (deepseek-flash): ~2.9s, ~9.6k prompt tokens per answer,
 *             roughly $0.0016 a question, and the strongest reader of
 *             this book's bilingual text. Funded by AI_COMPAT_KEY.
 *             When the wallet empties it returns 402 and the chain
 *             quietly hands over to Workers AI, so chat never dies.
 *
 *   workers   Cloudflare Workers AI via the binding named "AI".
 *             10k neurons/day free, no card, no second account, and it
 *             is NOT region-locked — it runs on Cloudflare's own network,
 *             so Hong Kong and mainland China are fine.
 *             Dashboard -> Workers & Pages -> rudao -> Settings
 *             -> Bindings -> Add -> Workers AI -> name it  AI
 *             -> Deployments -> Retry deployment.
 *             Models: @cf/google/gemma-4-26b-a4b-it, then
 *             @cf/meta/llama-3.3-70b-instruct-fp8-fast.
 *
 *   compat    Any OpenAI-compatible endpoint, for when you want a
 *             stronger Chinese model or an overflow when the free
 *             neurons run out. Same three variables work for all of:
 *               DeepSeek    AI_COMPAT_BASE = https://api.deepseek.com
 *                           AI_COMPAT_MODEL = deepseek-flash
 *                           (new accounts: 5M free tokens, no card)
 *               Doubao/Ark  AI_COMPAT_BASE = https://ark.cn-beijing.volces.com/api/v3
 *                           AI_COMPAT_MODEL = doubao-seed-2-1-pro-260628
 *                           (Volcano Ark: 500k free tokens per model)
 *               Qwen        AI_COMPAT_BASE = https://dashscope.aliyuncs.com/compatible-mode/v1
 *               GLM         AI_COMPAT_BASE = https://open.bigmodel.cn/api/paas/v4
 *               Moonshot    AI_COMPAT_BASE = https://api.moonshot.cn/v1
 *             AI_COMPAT_KEY = the provider key (store as a Secret).
 *
 *   gemini    Google Gemini. Region-locked in some places, so it is
 *             last and optional. GEMINI_API_KEY = AIza...
 *
 * 3. Nothing configured -> HTTP 503 with a friendly message and the
 *      widget falls back to "email Tony" mode. The site never breaks.
 *
 * HEALTH CHECK: GET /api/chat reports the provider chain without ever
 * echoing a key. Add ?probe=1 to make a real (unauthenticated) request
 * to the compat endpoint — it proves Cloudflare's edge can reach that
 * host and reports the round-trip time. Add ?probe=auth to send the key
 * with a one-token request, which tells "key rejected" (401) apart from
 * "key fine, wallet empty" (402).
 *
 * SECRETS (Cloudflare dashboard -> your Pages project -> Settings ->
 * Variables and Secrets; add as "Secret", then redeploy):
 *      AI_COMPAT_BASE, AI_COMPAT_KEY, AI_COMPAT_MODEL
 *      AI_ORDER       = compat,workers,gemini   (optional)
 *      CHAT_MODEL     = overrides the model per provider (optional)
 *      GEMINI_API_KEY = AIza...                 (optional)
 *
 * PRIVACY: each answered question is archived to the author's private
 * log (KV binding CHAT_LOG) so Tony can read what readers ask. Stored:
 * the question, the answer, model, country code, latency. Not stored:
 * IP address, cookies, browser identifiers. Entries expire after 180
 * days. Delete the binding to switch archiving off entirely; the chat
 * keeps working, it simply stops being recorded. The panel tells
 * readers that conversations may be kept for the author.
 */

import { archiveChat } from './_log.js';

const MAX_TURNS = 12;          // messages kept from the client
const MAX_CHARS = 1200;        // per user message
const MAX_BODY = 20000;        // bytes of JSON body
const WINDOW_MS = 60 * 60 * 1000;
const PER_IP_PER_HOUR = 30;

/* Workers AI models, in preference order. Checked against the model
   catalog on 2026-11-08:
     gemma-4-26b-a4b-it   256K ctx, $0.10/M in, $0.30/M out, no
                          deprecation, and it documents chat_template_kwargs
                          so thinking can be switched off. ~130 answers a
                          day inside the free 10k neurons.
     llama-3.3-70b        only 24K ctx and $0.293/$2.253 per M — kept as a
                          last resort only.
   Retired ids do not fail gracefully: llama-3.1-8b went on 2026-05-30 and
   qwen3-30b-a3b-fp8 is announced for 2026-11-20, so re-run ?models=1
   before trusting this list. */
const AI_MODELS = [
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
];

/* Candidates tried by GET /api/chat?models=1 — Cloudflare retires model
   ids without warning, so this probe answers "which of these actually
   runs on this account today". */
const MODEL_PROBE = [
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/zai-org/glm-4.7-flash',
  '@cf/openai/gpt-oss-120b',
  '@cf/qwen/qwen3-30b-a3b-fp8'
];

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

const SYSTEM = `You are "RuDao AI", the reading assistant on rudao.org, the official site of the book RuDao: Beyond The Art of War by Tony Tong (唐仪).

HOW TO ANSWER
- You are a knowledgeable guide to the book and its ideas. You are NOT Tony Tong and you never pretend to be him. If asked for a personal opinion "from Tony", say you can explain what the book argues, and point to the contact form for a personal reply.
- Ground every factual claim in the CONTEXT or FACT SHEET below. If something is not covered, say plainly that the site does not say, and offer the relevant page (/guide, /faq) or Tony's email.
- Never invent quotations, page numbers, prices, ISBNs, publication dates, awards, or endorsements.
- Be concise: every reply must read aloud in 30-40 seconds at most — about 100 English words or 160 Chinese characters. Short paragraphs, no bullet-point walls. Use at most one short quote.
- Plain text only: no markdown, no **bold**, no # headings, no tables. The chat panel renders raw text, so asterisks would show up literally. A short numbered list is fine.
- Never print a full URL (the voice reader would read the whole link aloud). Refer to pages by their short path instead, like /ch/daodejing, /guide, /faq.
- Keep Chinese terms next to their English sense, e.g. RuShang 儒商 (the Confucian merchant).
- Use the site's official romanization exactly as written in the FACT SHEET, with no spaces inserted: RuShang, RuJia, DaoJia, RuJiang, FanLi 范蠡, ZiGong 子贡, BaiGui 白圭, YiLiHeYi, SaiWeng ShiMa 塞翁失马. Write BaiGui, never "Bai Gui".
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
      headers: { 'User-Agent': 'RuDao-Chat/1.0 (+https://rudao.org)' },
      cf: { cacheTtl: 3600, cacheEverything: true }
    });
    if (!res.ok) return '';
    let txt = await res.text();
    // Keep the prompt bounded; llms.txt is ~34k chars — read it all.
    if (txt.length > 44000) txt = txt.slice(0, 44000);
    ctxCache = { text: txt, at: Date.now() };
    return txt;
  } catch (err) {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Classic reader — Appendix C publishes three pre-Qin classics in     */
/* full on the site. When a reader asks the assistant to read one,     */
/* fetch that page's real text and hand it to the model so it recites  */
/* the site's words instead of refusing. The texts are public-domain   */
/* pre-Qin classics; results are cached in the isolate for one hour.   */
/* ------------------------------------------------------------------ */
const CLASSICS = [
  {
    id: 'lunyu',
    path: '/ch/lunyu',
    title: 'The Analects LunYu 论语',
    re: /lun\s?yu|analects|论语|論語/i
  },
  {
    id: 'daodejing',
    path: '/ch/daodejing',
    title: 'Tao Te Ching DaoDeJing 道德经',
    re: /daodejing|dao\s?de\s?jing|tao\s?te\s?ching|道德经|道德經|laozi|老子/i
  },
  {
    id: 'artofwar',
    path: '/ch/artofwar',
    title: 'The Art of War SunZi BingFa 孙子兵法',
    re: /art\s?of\s?war|artofwar|sunzi|sun\s?tzu|sun\s?wu|孙子兵法|孫子兵法|孙子|孫子/i
  }
];
const READ_INTENT =
  /\b(read|reading|recite|recital|recitation|quote|aloud|voice|show|begin|start|open|tell|content|contents|text|chapter|chapters)\b|原文|全文|内容|朗读|朗讀|朗诵|誦讀|诵读|读|讀|念|背|讲|講|说|說|告诉|告訴|介绍|介紹|列|开头|開頭|第一章|第一篇|第一|头|頭|前|多少章|多少篇|有几章|有幾章/i;
const MAX_CLASSIC_CHARS = 40000;
const classicCache = {};

function detectClassic(lastUserText, prevUserText) {
  const t = String(lastUserText || '');
  if (!READ_INTENT.test(t)) return null;
  for (const c of CLASSICS) {
    if (c.re.test(t)) return c;
  }
  /* "read it" right after a message that named the classic */
  if (prevUserText) {
    for (const c of CLASSICS) {
      if (c.re.test(prevUserText)) return c;
    }
  }
  return null;
}

/* Page reference: when the reader pastes a link to one of the site's
   own pages, fetch that page's text and hand it to the model, so the
   assistant can answer about book content even when the llms.txt
   summary does not cover it. */
const MAX_PAGE_CHARS = 12000;
const pageCache = {};
const PAGE_REF_RE = /(?:https?:\/\/(?:www\.)?rudao\.org)?(\/ch\/[a-z0-9]+)/i;

function detectPageRef(text) {
  const m = PAGE_REF_RE.exec(String(text || ''));
  return m ? m[1].toLowerCase() : null;
}

async function getPageText(origin, path) {
  const cached = pageCache[path];
  if (cached && Date.now() - cached.at < 3600 * 1000) return cached.text;
  try {
    const res = await fetch(origin + path, {
      headers: { 'User-Agent': 'RuDao-Chat/1.0 (+https://rudao.org)' },
      cf: { cacheTtl: 3600, cacheEverything: true }
    });
    if (!res.ok) return '';
    const text = extractText(await res.text()).slice(0, MAX_PAGE_CHARS);
    if (text) pageCache[path] = { text, at: Date.now() };
    return text;
  } catch (err) {
    return '';
  }
}

/* HTML -> plain text, one line per block element. Good enough for the
   site's own chapter pages, which are static server-rendered HTML. */
function extractText(html) {
  let t = String(html || '');
  t = t.replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  const main = t.match(/<main\b[\s\S]*?<\/main\s*>/i);
  if (main) t = main[0];
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|td|th)\s*>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  t = t
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&mdash;/gi, '-')
    .replace(/&ndash;/gi, '-')
    .replace(/&middot;/gi, '·')
    .replace(/&#(\d+);/g, (m, n) => {
      try { return String.fromCodePoint(parseInt(n, 10)); } catch (e) { return m; }
    });
  const lines = t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  return lines.filter(Boolean).join('\n');
}

async function getClassicText(origin, classic) {
  const cached = classicCache[classic.id];
  if (cached && Date.now() - cached.at < 3600 * 1000) return cached.text;
  try {
    const res = await fetch(origin + classic.path, {
      headers: { 'User-Agent': 'RuDao-Chat/1.0 (+https://rudao.org)' },
      cf: { cacheTtl: 3600, cacheEverything: true }
    });
    if (!res.ok) return '';
    const text = extractText(await res.text()).slice(0, MAX_CLASSIC_CHARS);
    if (text) classicCache[classic.id] = { text, at: Date.now() };
    return text;
  } catch (err) {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */
async function callGemini(env, systemPrompt, turns, maxOut) {
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
      generationConfig: { temperature: 0.6, maxOutputTokens: maxOut || 700, topP: 0.9 },
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
  return { ok: true, reply, model };
}

async function callWorkersAI(env, systemPrompt, turns, maxOut) {
  /* CHAT_MODEL wins if set; otherwise try the cheap bilingual model
     first, then the small Llama that is available on every account. */
  const models = env.CHAT_MODEL ? [env.CHAT_MODEL] : AI_MODELS;
  const outCap = maxOut || 700;
  const messages = [{ role: 'system', content: systemPrompt }].concat(
    turns.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
  );

  let last = { ok: false, status: 502, detail: 'no model attempted' };

  for (const model of models) {
    /* Only send chat_template_kwargs to the models that document it.
       An unknown field on qwen3 took the whole isolate down (error
       1101), so this is deliberately a whitelist, not a guess. */
    const input = /gemma-4/i.test(model)
      ? {
        messages,
        max_completion_tokens: outCap,
        temperature: 0.6,
        chat_template_kwargs: { enable_thinking: false }
      }
      : { messages, max_tokens: outCap, temperature: 0.6 };
    try {
      const out = await env.AI.run(model, input);
      let reply = '';
      if (out && typeof out.response === 'string') reply = out.response;
      else if (out && out.choices && out.choices[0] && out.choices[0].message) {
        reply = out.choices[0].message.content || '';
      } else if (out && typeof out.result === 'string') reply = out.result;
      reply = cleanReply(reply);
      if (reply) return { ok: true, reply, model };
      last = { ok: false, status: 502, detail: 'empty response from ' + model };
    } catch (err) {
      last = {
        ok: false,
        status: 502,
        detail: (model + ': ' + String((err && err.message) || err)).slice(0, 240)
      };
    }
  }
  return last;
}

/* Voice replies must stay short: the panel reads answers aloud with TTS,
   and the author capped them at 30-40 seconds. Estimate spoken length
   (English ~2.6 words/s, Chinese ~4.2 chars/s) and, when a reply runs
   over, trim it back to the last sentence boundary that fits. */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
function spokenSeconds(text) {
  const words = (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
  const cjk = (text.match(CJK_RE) || []).length;
  return words / 2.6 + cjk / 4.2;
}
function capSpeech(raw) {
  const t = String(raw || '');
  if (spokenSeconds(t) <= 40) return t;
  const sentences = t.split(/(?<=[。！？!?])\s*|(?<=\.)\s+(?=[A-Z"'])/);
  let out = '';
  for (const s of sentences) {
    if (out && spokenSeconds(out + s) > 38) break;
    out += s;
  }
  return (out || t).trim();
}

/* Strip reasoning traces some models leak into the answer. */
function cleanReply(raw) {
  let t = String(raw || '');
  t = t.replace(/<think\b[^>]*>[\s\S]*?<\/think\b[^>]*>/gi, '');
  const dangling = t.toLowerCase().lastIndexOf('</think');
  if (dangling !== -1) {
    const gt = t.indexOf('>', dangling);
    if (gt !== -1) t = t.slice(gt + 1);
  }
  return t
    .replace(/\*\*/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/<\|?think\|?>/gi, '')
    .replace(/https?:\/\/(www\.)?rudao\.org/gi, '')  /* keep the short path only */
    .replace(/\s*https?:\/\/\S+/gi, '')              /* strip any other long link */
    .trim();
}

/* ------------------------------------------------------------------ */
/* Any OpenAI-compatible endpoint — DeepSeek, Doubao/Ark, Qwen, GLM,   */
/* Moonshot, OpenRouter, a local gateway. One adapter for all of them. */
/* ------------------------------------------------------------------ */
function compatConfig(env) {
  return {
    base: String((env && env.AI_COMPAT_BASE) || '').replace(/\/+$/, ''),
    key: (env && env.AI_COMPAT_KEY) || '',
    model: (env && (env.CHAT_MODEL || env.AI_COMPAT_MODEL)) || '',
    get ready() { return !!(this.base && this.key && this.model); }
  };
}

/* DeepSeek and Doubao/Ark both think before they answer by default.
   For a 90-180 word reading-assistant reply that is wasted tokens and
   ten wasted seconds, so ask for the non-thinking path where it exists.
   Other hosts ignore or reject the field, so only send it to the ones
   known to understand it. */
function wantsThinkingFlag(base) {
  return /deepseek\.com|volces\.com|bytepluses\.com|bigmodel\.cn/i.test(base);
}

async function callCompat(env, systemPrompt, turns, maxOut) {
  const cfg = compatConfig(env);
  if (!cfg.ready) return { ok: false, status: 0, detail: 'compat not configured' };

  const messages = [{ role: 'system', content: systemPrompt }]
    .concat(turns.map((m) => ({ role: m.role, content: m.content })));

  const send = async (withFlag) => {
    const body = {
      model: cfg.model,
      messages,
      temperature: 0.6,
      max_tokens: maxOut || 700,
      stream: false
    };
    if (withFlag) body.thinking = { type: 'disabled' };
    const res = await fetch(cfg.base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.key
      },
      body: JSON.stringify(body)
    });
    return { res, text: await res.text() };
  };

  const useFlag = wantsThinkingFlag(cfg.base);
  let out = await send(useFlag);
  /* A host that does not know the field answers 400 — retry bare. */
  if (!out.res.ok && out.res.status === 400 && useFlag) out = await send(false);

  if (!out.res.ok) {
    return {
      ok: false,
      status: out.res.status,
      detail: out.text.slice(0, 300),
      model: cfg.model
    };
  }

  let data;
  try { data = JSON.parse(out.text); }
  catch (err) { return { ok: false, status: 502, detail: 'bad json from ' + cfg.model }; }

  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  let reply = '';
  if (msg) {
    if (typeof msg.content === 'string') reply = msg.content;
    else if (Array.isArray(msg.content)) {
      reply = msg.content.map((p) => (p && p.text) || '').join('');
    }
  }
  reply = cleanReply(reply);
  if (!reply) return { ok: false, status: 502, detail: 'empty reply from ' + cfg.model };
  return { ok: true, reply, model: cfg.model };
}

/* ------------------------------------------------------------------ */
/* Provider chain — the funded key answers, the free tier absorbs the
   overflow and any upstream failure. Flip with AI_ORDER if that ever
   needs to change (e.g. workers,compat once the balance runs low). */
const PROVIDER_ORDER = ['compat', 'workers', 'gemini'];

function providerState(env) {
  return {
    workers: !!(env && env.AI && typeof env.AI.run === 'function'),
    compat: compatConfig(env).ready,
    gemini: !!(env && env.GEMINI_API_KEY)
  };
}

function providerChain(env) {
  const wanted = String((env && env.AI_ORDER) || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const order = wanted.length ? wanted : PROVIDER_ORDER;
  const state = providerState(env);
  return order.filter((p) => state[p]);
}

function runProvider(name, env, systemPrompt, turns, maxOut) {
  maxOut = maxOut || 700;
  if (name === 'workers') return callWorkersAI(env, systemPrompt, turns, maxOut);
  if (name === 'compat') return callCompat(env, systemPrompt, turns, maxOut);
  return callGemini(env, systemPrompt, turns, maxOut);
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */
export async function onRequestPost(context) {
  try {
    return await handlePost(context);
  } catch (err) {
    /* Never let a reader see an opaque platform error page. */
    return json({
      ok: false,
      code: 'crash',
      detail: String((err && (err.stack || err.message)) || err).slice(0, 400)
    }, 200);
  }
}

async function handlePost(context) {
  const { request, env } = context;
  const startedAt = Date.now();

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

  const chain = providerChain(env);
  if (!chain.length) {
    return json({
      ok: false,
      code: 'not_configured',
      message: 'The AI assistant is not open yet. Tony answers readers personally: Tony@RuDao.org'
    }, 503);
  }

  const origin = new URL(request.url).origin;
  const site = await getContext(origin);

  /* Recital mode: the reader asked the assistant to read one of the
     three Appendix C classics. Give the model the page's real text and
     a bigger reply budget, so it reads the site's words instead of
     saying it cannot. */
  const classic = detectClassic(
    turns[turns.length - 1].content,
    turns.length > 1 ? turns[turns.length - 2].content : ''
  );
  let recitalNote = '';
  let maxOut = 380;
  let classicText = '';
  if (classic) {
    classicText = await getClassicText(origin, classic);
    if (classicText) {
      maxOut = 550;
      recitalNote = '\n\nRECITAL REQUEST — the reader asked you to read ' + classic.title +
        '. Its full text as published on this site follows below. Read it aloud exactly as it appears, in the site\'s order, without summarizing, shortening or refusing. If the reader named particular chapters (e.g. "the first 5 chapters", 头5篇, 第三章), read exactly those chapters from the text. Otherwise read one passage that takes at most 30-40 seconds to read aloud, starting from the beginning, then say the reader may say "continue" to hear the next passage. The word limit does not apply to a recital passage; the plain-text and no-markdown rules still do. These are public-domain pre-Qin classics published in full on this site, so the copyright boundary above does not apply to them.\n\n' +
        'FULL TEXT — ' + classic.title + ' (' + classic.path + '):\n' + classicText;
    }
  }

  /* Page reference: the reader pasted a link to one of the site's own
     pages. Fetch its real text so the assistant can answer from the
     book itself, even if the llms.txt summary misses that content. */
  let pageNote = '';
  if (!classic) {
    const lastUser = turns[turns.length - 1].content;
    const prevUser = turns.length > 1 ? turns[turns.length - 2].content : '';
    const pagePath = detectPageRef(lastUser) || detectPageRef(prevUser);
    if (pagePath) {
      const pageText = await getPageText(origin, pagePath);
      if (pageText) {
        pageNote = '\n\nPAGE REFERENCE — the reader shared a link to ' + pagePath +
          ' on this site. Its text follows below. Ground your answer in this text; ' +
          'if the answer is not in it, say so plainly. Do not print the URL.\n\n' +
          'PAGE TEXT — ' + pagePath + ':\n' + pageText;
      }
    }
  }

  const systemPrompt = SYSTEM + (site || '(site summary unavailable)') + '\n\nFACT SHEET:\n' + FACTS + recitalNote + pageNote;

  /* Walk the chain: a free provider that fails or hits its daily
     allowance hands over to the next one instead of showing an error. */
  let last = { ok: false, status: 502, detail: 'no provider answered' };
  const tried = [];
  for (const name of chain) {
    let r;
    try {
      r = await runProvider(name, env, systemPrompt, turns, maxOut);
    } catch (err) {
      r = { ok: false, status: 502, detail: String((err && err.message) || err).slice(0, 200) };
    }
    if (r && r.ok && r.reply) {
      r.reply = capSpeech(r.reply);
      archiveChat(context, turns, r, name, startedAt);
      return json({ ok: true, reply: r.reply, provider: name, model: r.model || null });
    }
    tried.push({ provider: name, status: (r && r.status) || 0, detail: (r && r.detail) || '' });
    last = r || last;
  }

  /* Deliberately 200 with ok:false: the widget keys off ok, and a 5xx
     body is the one thing Cloudflare's own edge may replace with an
     unhelpful "error code: 502" page. */
  return json({
    ok: false,
    code: 'upstream_error',
    status: last.status,
    tried,
    message: 'The assistant is briefly unavailable. Please try again, or email Tony@RuDao.org.'
  }, 200);
}

/* Health check — open /api/chat in a browser to see which provider
   actually reached production. Never echoes a secret, only booleans
   and hostnames. Add ?probe=1 to test real reachability from the edge. */
export async function onRequestGet(context) {
  try {
    return await handleGet(context);
  } catch (err) {
    return json({
      ok: false,
      code: 'crash',
      detail: String((err && (err.stack || err.message)) || err).slice(0, 400)
    }, 200);
  }
}

async function handleGet(context) {
  const { env, request } = context;
  const state = providerState(env);
  const cfg = compatConfig(env);
  let host = null;
  try { host = cfg.base ? new URL(cfg.base).host : null; } catch (err) { host = 'invalid-url'; }

  const chain = providerChain(env);
  const out = {
    ok: true,
    service: 'RuDao AI chat',
    live: chain.length > 0,
    chain,
    providers: {
      workers_ai: state.workers,
      compat: state.compat
        ? { host, model: cfg.model }
        : { configured: false, needs: ['AI_COMPAT_BASE', 'AI_COMPAT_KEY', 'AI_COMPAT_MODEL'] },
      gemini: state.gemini
    },
    order_note: 'chain follows AI_ORDER, default compat,workers,gemini (funded key first, free tier as fallback)',
    usage: 'POST {"messages":[{"role":"user","content":"..."}]}',
    fix: chain.length ? null
      : 'Add an AI binding named AI, or AI_COMPAT_BASE/KEY/MODEL, then Retry deployment.'
  };

  /* Which build is actually serving, and which AI-ish variable names
     exist in this environment. Names and presence only — never values.
     This is what tells "not redeployed" apart from "variable misnamed". */
  out.commit = String((env && (env.CF_PAGES_COMMIT_SHA || '')) || '').slice(0, 7) || null;
  out.branch = (env && env.CF_PAGES_BRANCH) || null;
  out.env_keys = Object.keys(env || {})
    .filter((k) => /compat|deepseek|gemini|ai_order|chat_model|ark|openai|chat_log|admin_password|^ai$/i.test(k))
    .sort()
    .map((k) => ({
      name: k,
      set: typeof env[k] === 'string' ? env[k].length > 0 : !!env[k]
    }));

  /* ?probe=1 sends one unauthenticated request: 401 means the host is
     reachable from Cloudflare's edge, a network error means it is not.
     ?probe=auth repeats it with the real key and 1 output token, which
     separates "key rejected" (401) from "key fine, wallet empty" (402).
     Costs at most a couple of tokens and reveals no key. */
  const probe = request ? new URL(request.url).searchParams.get('probe') : null;
  if (probe && cfg.base) {
    const withKey = probe === 'auth' && cfg.ready;
    const started = Date.now();
    const headers = { 'Content-Type': 'application/json' };
    if (withKey) headers.Authorization = 'Bearer ' + cfg.key;
    try {
      const res = await fetch(cfg.base + '/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model || 'probe',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: withKey ? 1 : undefined,
          stream: false
        })
      });
      const readings = {
        200: withKey ? 'key works and has credit' : 'reachable',
        401: withKey ? 'key rejected or missing' : 'reachable - 401 only means no key was sent',
        402: 'key is valid but the account balance is empty - top up',
        403: 'key lacks permission for this model',
        404: 'model name not found at this host',
        429: 'rate limited (free tiers are often a few requests per minute)',
        500: 'provider error'
      };
      out.probe = {
        host,
        signed: withKey,
        reachable: true,
        http: res.status,
        ms: Date.now() - started,
        reading: readings[res.status] || (res.status < 500 ? 'reachable' : 'host reachable, upstream error')
      };
      if (withKey && res.status === 402) out.probe.fix = 'Top up at platform.deepseek.com, or rely on the Workers AI binding.';
      if (withKey && res.status === 401) out.probe.fix = 'Create a new key and replace AI_COMPAT_KEY.';
    } catch (err) {
      out.probe = {
        host,
        signed: withKey,
        reachable: false,
        ms: Date.now() - started,
        error: String((err && err.message) || err).slice(0, 200)
      };
    }
  }

  /* ?models=1 asks Workers AI to run each candidate for a few tokens.
     Costs a handful of neurons and says which ids still exist.
     ?variant=thinkoff / nothink / plain narrows down how to stop a
     reasoning model from spending the whole budget thinking. */
  const modelsQ = request ? new URL(request.url).searchParams.get('models') : null;
  if (modelsQ) {
    if (!state.workers) {
      out.model_probe = { error: 'no AI binding on this deployment' };
    } else {
      const q = new URL(request.url);
      const variant = q.get('variant') || 'plain';
      const budget = Number(q.get('tokens')) || 80;
      const list = modelsQ === '1' ? MODEL_PROBE : modelsQ.split(',').map((s) => s.trim()).filter(Boolean);
      out.variant = variant;
      out.model_probe = [];
      for (const m of list) {
        const t0 = Date.now();
        const input = {
          messages: [{ role: 'user', content: 'Reply with one word: ok' }],
          max_tokens: budget
        };
        if (variant === 'thinkoff') input.chat_template_kwargs = { enable_thinking: false };
        if (variant === 'nothink') input.messages = [{ role: 'user', content: 'Reply with one word: ok /no_think' }];
        try {
          const r = await env.AI.run(m, input);
          const text = r && (typeof r.response === 'string' ? r.response
            : (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '');
          out.model_probe.push({
            model: m,
            ok: true,
            ms: Date.now() - t0,
            chars: String(text).length,
            sample: String(text).replace(/\s+/g, ' ').slice(0, 60)
          });
        } catch (err) {
          out.model_probe.push({
            model: m,
            ok: false,
            ms: Date.now() - t0,
            error: String((err && err.message) || err).slice(0, 160)
          });
        }
      }
    }
  }

  return json(out, 200);
}
