/**
 * RuDao chat widget — floating reader / buyer chat for rudao.us
 * ------------------------------------------------------------
 * Three tabs:
 *   1. Ask RuDao AI  — grounded on the book + site (POST /api/chat)
 *   2. Ask Tony      — email, contact form, and any messenger you enable
 *   3. Consulting    — paid sessions / signed copies (USDC + card links)
 *
 * Free trial: CONFIG.freeQuestions AI questions per browser (localStorage).
 * After that the panel offers Tony's channels and paid options; an access
 * code (emailed
 * after payment) unlocks unlimited AI chat on that browser. Only the
 * SHA-256 hash of the code lives in this file, never the code itself.
 *
 * CONFIGURE: edit the CONFIG block below. Any channel left as '' is
 * simply not rendered — no dead links.
 */
(function () {
  'use strict';

  var CONFIG = {
    endpoint: '/api/chat',
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

    freeQuestions: 10,
    accessCodeHash: '',                 /* sha256 hex of the unlock code; '' = code box disabled */
    sessionLabel: '60-minute private session with Tony Tong'
  };

  /* v2: raised the trial from 3 to 10, and a new key means every reader
     starts that trial from zero instead of inheriting the old count. */
  var QUOTA_KEY = 'rudao_chat_used_v2';
  var PRO_KEY = 'rudao_chat_pro';

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

  function usedCount() { return parseInt(lsGet(QUOTA_KEY, '0'), 10) || 0; }
  function isPro() { return lsGet(PRO_KEY, '') === '1'; }
  function left() { return isPro() ? Infinity : Math.max(0, CONFIG.freeQuestions - usedCount()); }

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
  var root, panel, log, input, sendBtn, quotaLine, paywall, tabBtns, views;

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
      '<span class="rp-fab-label">Chat<span class="rp-fab-cn">问书</span></span>';
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
    head.appendChild(brand);
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
    log = el('div', 'rp-log');
    log.setAttribute('aria-live', 'polite');
    quotaLine = el('p', 'rp-quota');

    paywall = el('div', 'rp-paywall');
    paywall.hidden = true;

    var form = el('form', 'rp-form');
    input = el('textarea', 'rp-input');
    input.rows = 1;
    input.placeholder = 'Ask about RuShang, 竞合, the book…';
    input.setAttribute('aria-label', 'Your question');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(96, input.scrollHeight) + 'px';
    });
    sendBtn = el('button', 'rp-send', 'Send');
    sendBtn.type = 'submit';
    form.appendChild(input);
    form.appendChild(sendBtn);
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });

    vAi.appendChild(log);
    vAi.appendChild(paywall);
    vAi.appendChild(quotaLine);
    vAi.appendChild(form);

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
    root.appendChild(fab);
    document.body.appendChild(root);

    wrapZh(panel);

    showTab('ai');
    renderQuota();
    seed();
    if (/[#?&]chat\b/.test(location.hash + location.search)) open();
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
    if (name === 'ai') setTimeout(function () { input.focus(); }, 30);
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

  function renderQuota() {
    if (isPro()) {
      quotaLine.textContent = 'Unlimited chat unlocked on this browser.';
      paywall.hidden = true;
      return;
    }
    var l = left();
    if (l > 0) {
      quotaLine.textContent = l + ' free ' + (l === 1 ? 'question' : 'questions') + ' left · ' +
        CONFIG.freeQuestions + ' free per reader';
      paywall.hidden = true;
    } else {
      quotaLine.textContent = 'Free trial used.';
      renderPaywall();
    }
    wrapZh(quotaLine);
  }

  function renderPaywall() {
    paywall.innerHTML = '';
    paywall.hidden = false;
    var h = el('strong', 'rp-paywall-title', 'You have used your ' + CONFIG.freeQuestions + ' free questions.');
    paywall.appendChild(h);
    paywall.appendChild(paragraph('Keep going two ways: ask Tony directly (free, he replies personally), or book a private session.'));

    var links = el('div', 'rp-links');
    links.appendChild(linkBtn('Email Tony', 'mailto:' + CONFIG.email));
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

  function submit() {
    if (busy) return;
    var q = (input.value || '').trim();
    if (!q) return;
    if (!isPro() && left() <= 0) { renderQuota(); return; }

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
      /* Only a real answer costs a free question. */
      if (!isPro()) { lsSet(QUOTA_KEY, String(usedCount() + 1)); renderQuota(); }
      messages.push({ role: 'assistant', content: reply });
      addMsg('assistant', reply);
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
        input.style.height = Math.min(96, input.scrollHeight) + 'px';
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
  }
  function closePanel() {
    panel.hidden = true;
    root.classList.remove('is-open');
    document.body.classList.remove('rp-lock-scroll');
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
