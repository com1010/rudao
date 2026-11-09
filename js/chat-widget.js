/**
 * RuDao chat widget — floating reader / buyer chat for rudao.org
 * ------------------------------------------------------------
 * Three tabs:
 *   1. Ask RuDao AI  — grounded on the book + site (POST /api/chat)
 *   2. Ask Tony      — email, contact form, and any messenger you enable
 *   3. Consulting    — paid sessions / signed copies (USDC + card links)
 *
 * Free allowance: CONFIG.freeTokens RuDao Tokens per browser (localStorage),
 * CONFIG.tokensPerQuestion spent per answered question. When the balance
 * runs out the panel offers Tony's channels and a way to buy more tokens;
 * an access code unlocks unlimited AI chat on that browser. Only the
 * SHA-256 hash of the code lives in this file, never the code itself.
 *
 * CONFIGURE: edit the CONFIG block below. Any channel left as '' is
 * simply not rendered — no dead links.
 */
(function () {
  'use strict';

  var CONFIG = {
    endpoint: '/api/chat',
    speakEndpoint: '/api/tts',

    /* Spoken when the panel opens (the author's cloned voices via /api/tts,
       one clip per language so each voice speaks its own language). */
    greetingEn: 'Welcome to RuDao.',
    greetingZh: '大家好,我是唐仪。欢迎来到儒道!',
    email: 'Tony@RuDao.org',
    contactAnchor: '#contact',
    usdcAnchor: '#vip-edition',

    /* Optional human-chat channels — paste a URL to switch them on. */
    telegram: '',                       /* e.g. 'https://t.me/TonyTong' */
    whatsapp: '',                       /* e.g. 'https://wa.me/85291234567' */
    wechatId: '',                       /* e.g. 'TonyTong' — shown as copy-to-clipboard */
    booking: '',                        /* e.g. 'https://cal.com/tonytong/30min' */

    /* Paid options. Empty = hidden. */
    stripe: '',                         /* Stripe Payment Link (supports Google Pay / Apple Pay) */
    gumroad: '',                        /* Gumroad / Lemon Squeezy checkout */
    paypal: '',                         /* https://paypal.me/... */
    usdcNote: 'USDC (ERC20 / BASE / BEP20 / Solana)',

    /* RuDao Tokens — the reader's allowance, shown as a balance rather
       than a question count. 500 tokens at 10 per answer = 50 questions. */
    freeTokens: 500,                    /* granted to every reader on first visit */
    tokensPerQuestion: 10,              /* spent per answered question */
    tokensUrl: 'https://TonyTong.cc',   /* where to ask the author for more */
    accessCodeHash: '',                 /* sha256 hex of the unlock code; '' = code box disabled */
    sessionLabel: '60-minute private session with Tony Tong'
  };

  /* Tokens spent, not questions asked — the balance is what readers see.
     A fresh key means nobody inherits an old count from the 3-question era. */
  var QUOTA_KEY = 'rudao_chat_tokens_used';
  var PRO_KEY = 'rudao_chat_pro';

  /* ---------- voice reply (listen button + auto-play) ---------- */
  /* The server endpoint answers with real audio in the author's cloned
     voices (ElevenLabs: EN voice for English, ZH voice for Mandarin).
     When it is not configured it answers JSON and we fall back to the
     browser's built-in speech synthesis - free, works offline. */
  var SPEAK_ON = '\uD83D\uDD0A';    /* 🔊 idle   */
  var SPEAK_OFF = '\uD83D\uDD07';   /* 🔇 muted  */
  var SPEAK_BUSY = '\u2026';        /* … loading */
  var VOICE_KEY = 'rudao_chat_voice_on';   /* '0' = muted; default ON */
  /* token = the one channel every clip must hold. Starting a new sequence
     bumps it, so a paused or erroring old clip can never fire its fallback
     (that behaviour is exactly what put two voices on top of each other). */
  var speak = { audio: null, btn: null, token: 0 };

  function voiceAuto() { return lsGet(VOICE_KEY, '1') !== '0'; }

  function speakIdle(btn) {
    btn.textContent = SPEAK_ON;
    btn.classList.remove('is-playing');
    if (speak.btn === btn) speak.btn = null;
  }

  function stopSpeak() {
    speak.token += 1;                 /* silence every clip of older sequences */
    if (speak.audio) {
      var old = speak.audio;
      speak.audio = null;
      try { old.onended = null; old.onerror = null; } catch (e) { /* ignore */ }
      try { old.pause(); } catch (e) { /* ignore */ }
      try { old.removeAttribute('src'); old.load(); } catch (e) { /* ignore */ }
      try { if (old.src && old.src.indexOf('blob:') === 0) URL.revokeObjectURL(old.src); } catch (e) { /* ignore */ }
    }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    if (speak.btn) speakIdle(speak.btn);
    speak.btn = null;
  }

  /* Zero-cost fallback: the reader's own device does the talking.
     speechSynthesis queues the utterances, so a whole sequence plays in
     order even when the clips mix English and Mandarin. The token check
     keeps a superseded sequence from starting a second voice. */
  function browserSpeakAll(texts, btn, token) {
    if (!('speechSynthesis' in window)) { if (btn) speakIdle(btn); stopSpeak(); return; }
    texts.forEach(function (t, idx) {
      if (token !== speak.token) return;
      var clean = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
      var u = new SpeechSynthesisUtterance(clean);
      u.lang = /[\u4e00-\u9fff]/.test(clean) ? 'zh-CN' : 'en-US';
      u.rate = 1;
      if (idx === texts.length - 1) {
        u.onend = function () { if (token === speak.token) stopSpeak(); };
        u.onerror = function () { if (token === speak.token) stopSpeak(); };
      }
      try { window.speechSynthesis.speak(u); } catch (e) { stopSpeak(); }
    });
  }

  /* Play the texts one after another. Each clip is an <audio> element
     pointed straight at the streaming endpoint: the browser starts
     playing as soon as the first bytes arrive, instead of waiting for
     the whole clip to be synthesized (that fetch-blob round trip was
     the 5-second silence). If the server has no voice configured, the
     audio element errors out immediately and the browser engine takes
     the rest of the sequence. Only the newest sequence may make sound. */
  function speakSeq(texts, btn) {
    if (speak.btn && speak.btn === btn) { stopSpeak(); return; }  /* tap again stops it */
    stopSpeak();
    var token = speak.token;
    speak.btn = btn || null;
    if (btn) { btn.textContent = SPEAK_BUSY; btn.classList.add('is-playing'); }

    var i = 0;
    var serverFailed = false;
    function nextClip() {
      if (token !== speak.token) return;          /* a newer sequence took over */
      if (i >= texts.length) { stopSpeak(); return; }
      var t = texts[i++];
      if (serverFailed) {
        browserSpeakAll(texts.slice(i - 1), btn, token);
        return;
      }
      var a = new Audio(CONFIG.speakEndpoint + '?text=' + encodeURIComponent(t));
      speak.audio = a;
      a.preload = 'auto';
      a.onended = function () { if (token === speak.token) nextClip(); };
      a.onerror = function () {
        if (token !== speak.token) return;        /* stopped by us - stay silent */
        /* first clip failed -> the whole sequence goes to the browser engine */
        if (speak.audio === a) speak.audio = null;
        serverFailed = true;
        browserSpeakAll(texts.slice(i - 1), btn, token);
      };
      a.play().catch(function (err) {
        if (token !== speak.token) return;        /* superseded: never fall back */
        if (err && err.name === 'AbortError') return;
        if (speak.audio === a) speak.audio = null;
        serverFailed = true;
        browserSpeakAll(texts.slice(i - 1), btn, token);
      });
    }
    nextClip();
  }

  function speakText(text, btn) { speakSeq([text], btn); }

  /* ---------- tiny helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Chinese renders 3pt smaller and never bold — same rule as the site. */
  var CJK_RE = /((?:[\u3000-\u303F\uFE30-\uFE4F\uFF01-\uFF60\u2013-\u201D!-\/:-@\[-`{-~]*[\u2E80-\u2EFF\u3040-\u30FF\u3130-\u318F\u31C0-\u31EF\u3200-\u32FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+)+[\u3000-\u303F\uFE30-\uFE4F\uFF01-\uFF60\u2013-\u201D!-\/:-@\[-`{-~]*)/g;
  function wrapZh(root) {
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      if (!text || !CJK_RE.test(text)) return;
      CJK_RE.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var last = 0, m;
      while ((m = CJK_RE.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var span = document.createElement('span');
        span.className = 'zh';
        span.textContent = m[0];
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function lsGet(k, d) {
    try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function tokensUsed() { return parseInt(lsGet(QUOTA_KEY, '0'), 10) || 0; }
  function isPro() { return lsGet(PRO_KEY, '') === '1'; }
  function tokensLeft() {
    return isPro() ? Infinity : Math.max(0, CONFIG.freeTokens - tokensUsed());
  }
  /* Whole questions the remaining balance can still pay for. */
  function questionsLeft() {
    if (isPro()) return Infinity;
    return Math.floor(tokensLeft() / CONFIG.tokensPerQuestion);
  }

  function sha256(str) {
    if (!(window.crypto && crypto.subtle)) return Promise.resolve('');
    var buf = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', buf).then(function (h) {
      return Array.prototype.map.call(new Uint8Array(h), function (b) {
        return ('00' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  /* ---------- state ---------- */
  var messages = [];      /* {role:'user'|'assistant', content} */
  var busy = false;
  var built = false;
  var root, panel, log, input, sendBtn, quotaLine, paywall, tabBtns, views, tokenLine, voiceBtn;
  var micBtn, langBtn, recog, micOn;
  var micState = '';        /* '', 'rec' (mic open), 'wait' (patience window) */
  var micHeard = '';        /* final transcript accumulated this session */
  var micSubmitTimer = null;

  function renderVoiceBtn() {
    if (!voiceBtn) return;
    voiceBtn.textContent = voiceAuto() ? SPEAK_ON : SPEAK_OFF;
    voiceBtn.title = voiceAuto()
      ? 'Voice replies ON - click to mute 语音回复:开,点击关闭'
      : 'Voice replies OFF - click to auto-play 语音回复:关,点击开启';
  }

  /* ---------- build UI ---------- */
  function build() {
    if (built) return;
    built = true;

    root = el('div', 'rp-root');

    var fab = el('button', 'rp-fab');
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Open chat: ask about the book or contact the author');
    fab.innerHTML = '<span class="rp-fab-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.9 8.9 0 0 1-3.8-.8L3 21l1.8-5.4A8.4 8.4 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/></svg></span>' +
      '<span class="rp-fab-label"><span class="rp-fab-en">Chat about RuDao</span>' +
      '<span class="rp-fab-cn zh">儒道互动 谈书问道 有问必答</span></span>';
    fab.addEventListener('click', open);

    panel = el('div', 'rp-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat with RuDao AI or with the author');
    panel.hidden = true;

    /* header */
    var head = el('div', 'rp-head');
    var brand = el('div', 'rp-brand');
    brand.innerHTML = '<span class="rp-seal" aria-hidden="true">儒</span>' +
      '<span class="rp-brand-text"><strong>RuDao</strong><em>Ask the book · 问书</em></span>';
    var close = el('button', 'rp-close', '\u00d7');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close chat');
    close.addEventListener('click', closePanel);

    /* master voice switch: ON = the greeting and every AI reply are spoken
       automatically; OFF = silent unless the reader taps a 🔊 button */
    voiceBtn = el('button', 'rp-voice-toggle');
    voiceBtn.type = 'button';
    voiceBtn.setAttribute('aria-label', 'Toggle voice replies 语音开关');
    renderVoiceBtn();
    voiceBtn.addEventListener('click', function () {
      lsSet(VOICE_KEY, voiceAuto() ? '0' : '1');
      renderVoiceBtn();
      if (!voiceAuto()) stopSpeak();
    });

    head.appendChild(brand);
    head.appendChild(voiceBtn);
    head.appendChild(close);

    /* tabs */
    var tabs = el('div', 'rp-tabs');
    tabs.setAttribute('role', 'tablist');
    var defs = [
      ['ai', 'Ask RuDao AI'],
      ['tony', 'Ask Tony'],
      ['pro', 'Consulting']
    ];
    tabBtns = {};
    views = {};
    defs.forEach(function (d) {
      var b = el('button', 'rp-tab', d[1]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', function () { showTab(d[0]); });
      tabs.appendChild(b);
      tabBtns[d[0]] = b;
    });

    /* view: AI */
    var vAi = el('div', 'rp-view');

    /* Token notice — states the grant, and where to ask for more. Kept
       above the conversation so a first-time reader sees it without
       scrolling; the live balance sits under the input. */
    var tokenNote = el('div', 'rp-tokens');
    tokenLine = paragraph('', 'rp-tokens-line');
    tokenNote.appendChild(tokenLine);
    tokenNote.appendChild(paragraph(
      'If you need to chat more and want to buy more RuDao Tokens, please write to TonyTong.cc and leave a message for the author.',
      'rp-tokens-fine'));

    log = el('div', 'rp-log');
    log.setAttribute('aria-live', 'polite');
    quotaLine = el('p', 'rp-quota');

    paywall = el('div', 'rp-paywall');
    paywall.hidden = true;

    var form = el('form', 'rp-form');
    input = el('textarea', 'rp-input');
    input.rows = 4;
    input.placeholder = 'Ask about RuShang, 竞合, the book… or tap the mic';
    input.setAttribute('aria-label', 'Your question');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(190, input.scrollHeight) + 'px';
    });
    sendBtn = el('button', 'rp-send', 'Send');
    sendBtn.type = 'submit';
    form.appendChild(input);

    /* Voice typing — the mic button uses the browser's built-in Web
       Speech API (Chrome, Edge, Safari 14.1+). Firefox has no speech
       input yet, so the button simply does not appear there. The final
       transcript lands in the input and sends automatically, so the
       reader just speaks the question. */
    var SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SRClass) {
      var actions = el('div', 'rp-actions');
      /* Language pill: Web Speech API cannot auto-detect the spoken
         language, so the reader picks the recognizer. AUTO follows the
         browser language; one click cycles AUTO -> 中 -> EN and the
         choice is remembered on this device. */
      langBtn = el('button', 'rp-mic-lang', micLangLabel());
      langBtn.type = 'button';
      langBtn.setAttribute('aria-label', 'Voice input language 语音识别语言');
      langBtn.title = 'Voice input language: Auto (browser). Click for 中文 / English.';
      langBtn.addEventListener('click', function () { cycleMicLang(); });
      micBtn = el('button', 'rp-mic');
      micBtn.type = 'button';
      micBtn.setAttribute('aria-label', 'Voice typing 语音输入');
      micBtn.title = 'Voice typing 语音输入 (click again to stop)';
      micBtn.innerHTML = '<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';
      micBtn.addEventListener('click', function () { toggleMic(); });
      actions.appendChild(langBtn);
      actions.appendChild(micBtn);
      actions.appendChild(sendBtn);
      form.appendChild(actions);
    } else {
      form.appendChild(sendBtn);
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });

    /* Input box sits at the TOP of the chat page (user 2026-11-10),
       so the reader can type or speak immediately; the conversation
       log, quota and notices follow below. */
    vAi.appendChild(form);
    vAi.appendChild(tokenNote);
    vAi.appendChild(log);
    vAi.appendChild(paywall);
    vAi.appendChild(quotaLine);

    /* Plain notice: the author keeps a copy of these conversations. */
    var consent = paragraph(
      'Conversations may be kept so Tony can read them later. Please do not send passwords, card numbers or other sensitive details.',
      'rp-fine rp-consent');
    vAi.appendChild(consent);

    /* view: Tony */
    var vTony = el('div', 'rp-view');
    vTony.appendChild(paragraph('Tony answers readers himself when he can. Direct chat is free for the first one or two conversations — after that, longer questions go through the consulting tab.'));
    var links = el('div', 'rp-links');
    links.appendChild(linkBtn('Email Tony · ' + CONFIG.email, 'mailto:' + CONFIG.email));
    if (CONFIG.contactAnchor) links.appendChild(linkBtn('Use the contact form', CONFIG.contactAnchor));
    if (CONFIG.telegram) links.appendChild(linkBtn('Telegram', CONFIG.telegram));
    if (CONFIG.whatsapp) links.appendChild(linkBtn('WhatsApp', CONFIG.whatsapp));
    if (CONFIG.booking) links.appendChild(linkBtn('Book a call', CONFIG.booking));
    if (CONFIG.wechatId) links.appendChild(copyBtn('WeChat · ' + CONFIG.wechatId, CONFIG.wechatId));
    vTony.appendChild(links);
    vTony.appendChild(paragraph('Typical reply time: 1-2 working days. For translations, bulk orders or speaking, say so in the first line so it is routed properly.', 'rp-fine'));

    /* view: Consulting */
    var vPro = el('div', 'rp-view');
    vPro.appendChild(paragraph(CONFIG.sessionLabel + '. Three ways to start:', 'rp-lead'));
    var proList = el('ol', 'rp-steps');
    [
      'Write one paragraph about your situation to ' + CONFIG.email + '.',
      'Tony confirms scope, fee and time slot by email.',
      'Pay by USDC or card link, then book the slot.'
    ].forEach(function (t) { proList.appendChild(el('li', '', t)); });
    vPro.appendChild(proList);

    var pay = el('div', 'rp-links');
    if (CONFIG.stripe) pay.appendChild(linkBtn('Pay by card / Google Pay', CONFIG.stripe));
    if (CONFIG.gumroad) pay.appendChild(linkBtn('Checkout (Gumroad)', CONFIG.gumroad));
    if (CONFIG.paypal) pay.appendChild(linkBtn('PayPal', CONFIG.paypal));
    if (CONFIG.usdcAnchor) pay.appendChild(linkBtn('USDC addresses · ' + CONFIG.usdcNote, CONFIG.usdcAnchor));
    vPro.appendChild(pay);
    vPro.appendChild(paragraph('Signed copies and the VIP edition are ordered from the author directly — same email.', 'rp-fine'));

    panel.appendChild(head);
    panel.appendChild(tabs);
    panel.appendChild(vAi);
    panel.appendChild(vTony);
    panel.appendChild(vPro);

    root.appendChild(panel);
    /* A page may supply its own trigger, the way the homepage hero does.
       Then it also owns the placement, and a second floating pill doing
       the same job would only sit on top of the hero button, so it is
       never mounted. */
    if (document.querySelector('[data-rp-hide-fab]')) {
      root.className = 'rp-root rp-no-fab';
    } else {
      root.appendChild(fab);
    }
    document.body.appendChild(root);

    wrapZh(panel);

    showTab('ai');
    renderQuota();
    seed();
    /* Standalone chat page (/chat) opts in via data-rp-autopen on <body>;
       other pages auto-open only when the URL carries #chat or ?chat. */
    if (document.body.hasAttribute('data-rp-autopen') ||
        /[#?&]chat\b/.test(location.hash + location.search)) open();
  }

  function paragraph(text, cls) {
    var p = el('p', 'rp-p' + (cls ? ' ' + cls : ''));
    p.textContent = text;
    return p;
  }

  function linkBtn(label, href) {
    var a = el('a', 'rp-btn', label);
    a.href = href;
    if (href.indexOf('http') === 0) { a.target = '_blank'; a.rel = 'noopener'; }
    if (href.charAt(0) === '#' && href.length > 1) {
      a.addEventListener('click', function () { closePanel(); });
    }
    return a;
  }

  function copyBtn(label, value) {
    var b = el('button', 'rp-btn', label);
    b.type = 'button';
    b.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(value);
      b.textContent = 'Copied · 已复制';
      wrapZh(b);
      setTimeout(function () { b.textContent = label; wrapZh(b); }, 1600);
    });
    return b;
  }

  function showTab(name) {
    Object.keys(tabBtns).forEach(function (k) {
      tabBtns[k].classList.toggle('is-on', k === name);
      tabBtns[k].setAttribute('aria-selected', k === name ? 'true' : 'false');
    });
    var map = { ai: 0, tony: 1, pro: 2 };
    Array.prototype.forEach.call(panel.querySelectorAll('.rp-view'), function (v, i) {
      v.hidden = i !== map[name];
    });
    if (name === 'ai') setTimeout(function () {
      /* focus without letting the browser scroll the token notice out of
         view, then pin the view to the top anyway */
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      var v = panel.querySelector('.rp-view:not([hidden])');
      if (v) v.scrollTop = 0;
    }, 30);
  }

  function seed() {
    if (messages.length) return;
    addMsg('assistant',
      'Welcome. I can explain anything in RuDao - the RuShang idea, 竞合 co-opetition, FanLi and ZiGong, the Eight Virtues. ' +
      'For a personal reply from Tony, open the "Ask Tony" tab.');
  }

  function addMsg(role, text) {
    var row = el('div', 'rp-msg rp-' + role);
    var bubble = el('div', 'rp-bubble');
    bubble.textContent = text;
    row.appendChild(bubble);
    if (role === 'assistant') {
      var sp = el('button', 'rp-speak');
      sp.type = 'button';
      sp.textContent = SPEAK_ON;
      sp.setAttribute('aria-label', 'Listen to this reply');
      sp.title = 'Listen to this reply 朗读这条回复';
      sp.addEventListener('click', function () { speakText(text, sp); });
      row.appendChild(sp);
    }
    log.appendChild(row);
    wrapZh(bubble);
    log.scrollTop = log.scrollHeight;
    return row;
  }

  function typing(on) {
    var existing = log.querySelector('.rp-typing-row');
    if (!on) { if (existing) existing.remove(); return; }
    if (existing) return;
    var row = el('div', 'rp-msg rp-assistant rp-typing-row');
    var b = el('div', 'rp-bubble rp-typing');
    b.innerHTML = '<span></span><span></span><span></span>';
    row.appendChild(b);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  /* The line above the conversation carries the balance too, so a reader
     never sees "100" after spending forty of them. */
  function renderTokens(t) {
    if (!tokenLine) return;
    var line;
    if (isPro()) {
      line = 'You have unlimited RuDao Tokens on this browser, and you can use them to chat about the book or to consult with the author, Tony Tong (TonyTong.cc).';
    } else if (t > 0) {
      line = 'You have ' + t + ' free RuDao Tokens, and you can use them to chat about the book or to consult with the author, Tony Tong (TonyTong.cc).';
    } else {
      line = 'Your free RuDao Tokens are used up. Write to TonyTong.cc and ask the author for more.';
    }
    if (tokenLine.textContent !== line) {
      tokenLine.textContent = line;
      wrapZh(tokenLine);
    }
  }

  function renderQuota() {
    if (isPro()) {
      quotaLine.textContent = 'Unlimited chat unlocked on this browser.';
      paywall.hidden = true;
      renderTokens(Infinity);
      wrapZh(quotaLine);
      return;
    }
    var t = tokensLeft();
    var q = questionsLeft();
    renderTokens(t);
    if (q > 0) {
      quotaLine.textContent = 'Balance: ' + t + ' RuDao Tokens · ' + CONFIG.tokensPerQuestion +
        ' per question · ' + q + ' more ' + (q === 1 ? 'question' : 'questions');
      paywall.hidden = true;
    } else {
      quotaLine.textContent = 'Balance: 0 RuDao Tokens.';
      renderPaywall();
    }
    wrapZh(quotaLine);
  }

  function renderPaywall() {
    paywall.innerHTML = '';
    paywall.hidden = false;
    var h = el('strong', 'rp-paywall-title',
      'Your ' + CONFIG.freeTokens + ' free RuDao Tokens are used up.');
    paywall.appendChild(h);
    paywall.appendChild(paragraph(
      'You can still write to Tony directly - he answers readers himself. To buy more RuDao Tokens and keep chatting with the book, ask him for a top-up.'));

    var links = el('div', 'rp-links');
    if (CONFIG.tokensUrl) links.appendChild(linkBtn('Buy more tokens · TonyTong.cc', CONFIG.tokensUrl));
    if (CONFIG.contactAnchor) links.appendChild(linkBtn('Leave a message for Tony', CONFIG.contactAnchor));
    links.appendChild(linkBtn('Email Tony · ' + CONFIG.email, 'mailto:' + CONFIG.email));
    var toPro = el('button', 'rp-btn rp-btn-accent', 'See consulting options');
    toPro.type = 'button';
    toPro.addEventListener('click', function () { showTab('pro'); });
    links.appendChild(toPro);
    paywall.appendChild(links);

    if (CONFIG.accessCodeHash) {
      var row = el('form', 'rp-code');
      var inp = el('input', 'rp-code-input');
      inp.type = 'text';
      inp.placeholder = 'Access code from Tony';
      inp.setAttribute('aria-label', 'Access code');
      var ok = el('button', 'rp-btn', 'Unlock');
      ok.type = 'submit';
      var note = el('p', 'rp-fine');
      row.appendChild(inp);
      row.appendChild(ok);
      row.addEventListener('submit', function (e) {
        e.preventDefault();
        sha256(inp.value.trim()).then(function (h2) {
          if (h2 && h2 === CONFIG.accessCodeHash) {
            lsSet(PRO_KEY, '1');
            note.textContent = 'Unlocked.';
            renderQuota();
            addMsg('assistant', 'Unlocked - ask as much as you like.');
          } else {
            note.textContent = 'That code does not match. Check the email from Tony, or write to ' + CONFIG.email + '.';
          }
        });
      });
      paywall.appendChild(row);
      paywall.appendChild(note);
    }
    wrapZh(paywall);
  }

  /* ---------- voice typing (mic button) ---------- */

  /* Speech input language: the recognizer must match the language you
     speak, or the transcript turns to garble. AUTO follows the browser
     language; 中 forces Mandarin zh-CN; EN forces English en-US. */
  function micLangMode() {
    var m = lsGet('rudao_chat_mic_lang', 'auto');
    return (m === 'zh' || m === 'en') ? m : 'auto';
  }
  function micLang() {
    var m = micLangMode();
    if (m === 'zh') return 'zh-CN';
    if (m === 'en') return 'en-US';
    return /^zh/i.test(navigator.language || '') ? 'zh-CN' : 'en-US';
  }
  function micLangLabel() {
    var m = micLangMode();
    return m === 'zh' ? '中' : m === 'en' ? 'EN' : 'AUTO';
  }
  function cycleMicLang() {
    var m = micLangMode();
    m = m === 'auto' ? 'zh' : m === 'zh' ? 'en' : 'auto';
    lsSet('rudao_chat_mic_lang', m);
    if (langBtn) {
      langBtn.textContent = micLangLabel();
      langBtn.title = 'Voice input language: ' + micLangLabel() +
        ' - click to switch (AUTO follows browser, 中 = Mandarin, EN = English)';
    }
    setMicUI(micOn);
  }

  function setMicUI(on, note) {
    micOn = !!on;
    if (micBtn) micBtn.classList.toggle('listening', micOn);
    if (input) {
      input.placeholder = note || (micOn
        ? 'Listening… 请说话 [' + micLangLabel() + ' · ' + micLang() + ']'
        : 'Ask about RuShang, 竞合, the book… or tap the mic');
    }
  }

  /* Patience: a reader pausing to think is not finished speaking, so the
     question only sends after a full 6 seconds without new words. The
     recognizer runs in continuous mode and rests on our own idle timer -
     it is never restarted in a loop (each restart made the browser beep,
     and kept the mic hot after Send). */
  var MIC_PATIENCE_MS = 6000;
  var MIC_NO_SPEECH_MS = 12000;
  var micNoSpeechTimer = null;
  var micRestarts = 0;

  /* Hard stop: recogniser closed, timers cleared, nothing restarts it.
     Called on Send, on panel close, on mute-everything paths. */
  function micAbort(note) {
    if (micSubmitTimer) { clearTimeout(micSubmitTimer); micSubmitTimer = null; }
    if (micNoSpeechTimer) { clearTimeout(micNoSpeechTimer); micNoSpeechTimer = null; }
    micState = '';
    micHeard = '';
    micRestarts = 0;
    if (recog) {
      var r = recog;
      recog = null;
      try { r.onresult = null; r.onend = null; r.onerror = null; } catch (e) { /* ignore */ }
      try { r.abort(); } catch (e) { /* ignore */ }
      try { r.stop(); } catch (e) { /* ignore */ }
    }
    setMicUI(false, note);
  }

  function micFinish() {
    var heard = micHeard;
    var text = (input.value || '').trim();
    micAbort();
    if (heard && text && !busy) submit();
  }

  function micScheduleSend() {
    if (micSubmitTimer) clearTimeout(micSubmitTimer);
    micSubmitTimer = setTimeout(micFinish, MIC_PATIENCE_MS);
  }

  function micResume() {
    if (!recog) { micStart(); return; }
    micState = 'rec';
    try { recog.start(); setMicUI(true); } catch (e) { micFinish(); }
  }

  function micStart() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    micAbort();
    try { recog = new SR(); } catch (e) { recog = null; return; }
    micHeard = '';
    micRestarts = 0;
    micState = 'rec';
    recog.lang = micLang();
    recog.interimResults = true;
    recog.continuous = true;
    recog.onresult = function (ev) {
      if (!micState) return;                    /* stopped by the reader */
      micState = 'rec';
      micRestarts = 0;
      if (micNoSpeechTimer) { clearTimeout(micNoSpeechTimer); micNoSpeechTimer = null; }
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i += 1) {
        var t = (ev.results[i] && ev.results[i][0] && ev.results[i][0].transcript) || '';
        if (ev.results[i].isFinal) micHeard += t; else interim += t;
      }
      input.value = (micHeard + interim).trim();
      input.style.height = 'auto';
      input.style.height = Math.min(190, input.scrollHeight) + 'px';
      setMicUI(true);
      micScheduleSend();                        /* every new word restarts the 6s window */
    };
    recog.onerror = function (ev) {
      var err = (ev && ev.error) || 'error';
      if (err === 'aborted') return;
      if (err === 'no-speech') return;          /* idle timer decides */
      micAbort(err === 'not-allowed' || err === 'service-not-allowed'
        ? 'Microphone blocked - allow mic access for this site, then tap the mic again.'
        : 'Voice input unavailable (' + err + '). Please type your question.');
    };
    recog.onend = function () {
      if (!micState) return;                    /* we closed it ourselves */
      micState = 'wait';
      if (!micHeard) { micAbort(); return; }     /* nothing captured - go quiet */
      setMicUI(true, 'Still listening… 继续说，或停约 6 秒自动发送');
      /* the browser ended the session on its own; reopen it once or twice
         while the reader is still inside the thinking window */
      if (micRestarts >= 2) { micScheduleSend(); return; }
      micRestarts += 1;
      try {
        recog.start();
        micState = 'rec';
      } catch (e) { micScheduleSend(); }
    };
    try {
      recog.start();
      setMicUI(true);
      micNoSpeechTimer = setTimeout(function () {
        if (!micHeard && micState) micAbort('Did not hear anything - tap the mic and speak. 没有听到声音');
      }, MIC_NO_SPEECH_MS);
    } catch (e) { micAbort(); }
  }

  function toggleMic() {
    if (micState === 'rec') { micFinish(); return; }   /* tap again = stop and send */
    if (micState === 'wait') { micResume(); return; }
    micStart();
  }

  function submit() {
    if (busy) return;
    /* The moment a question is sent the microphone goes deaf: no listening
       indicator, no re-opened recogniser, no beeps while the answer is
       being written. Any reply still talking is stopped as well. */
    micAbort();
    stopSpeak();
    var q = (input.value || '').trim();
    if (!q) return;
    if (!isPro() && questionsLeft() <= 0) { renderQuota(); return; }

    input.value = '';
    input.style.height = 'auto';
    addMsg('user', q);
    messages.push({ role: 'user', content: q });

    busy = true;
    sendBtn.disabled = true;
    typing(true);

    fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.slice(-10) })
    }).then(function (r) {
      return r.json().then(function (d) { return { status: r.status, data: d }; });
    }).then(function (res) {
      typing(false);
      var d = res.data || {};
      if (!res.status || res.status >= 400 || d.ok === false) {
        failed(res.status, d.message);
        return;
      }
      var reply = String(d.reply || '').trim();
      if (!reply) { failed(res.status); return; }
      /* Only a real answer costs tokens. */
      if (!isPro()) { lsSet(QUOTA_KEY, String(tokensUsed() + CONFIG.tokensPerQuestion)); renderQuota(); }
      messages.push({ role: 'assistant', content: reply });
      var row = addMsg('assistant', reply);
      /* Voice ON by default: the reply is spoken as it appears, in the
         author's own voice. The reader can mute via the header switch;
         the per-message 🔊 button always works either way. */
      if (voiceAuto()) {
        var sp = row.querySelector('.rp-speak');
        if (sp) speakText(reply, sp);
      }
    }).catch(function () {
      typing(false);
      failed(0);
    }).then(function () {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    });
  }

  /* The answer never arrived: refund the turn, put the text back in the
     box, and say who can help instead. */
  function failed(status, note) {
    if (messages.length && messages[messages.length - 1].role === 'user') {
      var lastQ = messages.pop().content;
      var rows = log.querySelectorAll('.rp-msg.rp-user');
      if (rows.length) rows[rows.length - 1].parentNode.removeChild(rows[rows.length - 1]);
      if (!input.value) {
        input.value = lastQ;
        input.style.height = 'auto';
        input.style.height = Math.min(190, input.scrollHeight) + 'px';
      }
    }
    offerFallback(status === 503
      ? 'The AI assistant is not open yet - your question was not counted.'
      : note);
  }

  function offerFallback(note) {
    var row = el('div', 'rp-msg rp-assistant');
    var b = el('div', 'rp-bubble rp-bubble-warn');
    b.textContent = (note || 'The assistant is not reachable right now.') +
      ' You can still write to Tony directly: ' + CONFIG.email;
    row.appendChild(b);
    log.appendChild(row);
    wrapZh(b);
    log.scrollTop = log.scrollHeight;
  }

  /* ---------- open / close ---------- */
  function open() {
    build();
    panel.hidden = false;
    root.classList.add('is-open');
    document.body.classList.add('rp-lock-scroll');
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 40);
    /* the author greets every reader by voice (his own cloned voices,
       one clip per language); silenced when the reader muted the chat */
    if (voiceAuto()) speakSeq([CONFIG.greetingEn, CONFIG.greetingZh], null);
  }
  function closePanel() {
    micAbort();
    panel.hidden = true;
    root.classList.remove('is-open');
    document.body.classList.remove('rp-lock-scroll');
    stopSpeak();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel && !panel.hidden) closePanel();
  });

  window.addEventListener('hashchange', function () {
    if (/[#?&]chat\b/.test(location.hash)) open();
  });

  /* Any element with data-rp-open (e.g. the link in the contact section)
     opens the panel, even when the URL hash is already #chat. */
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document) {
      if (t.hasAttribute && t.hasAttribute('data-rp-open')) {
        e.preventDefault();
        open();
        return;
      }
      t = t.parentNode;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
