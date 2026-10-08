/* ============================================================
   Readers' Blog · 读者博客
   Public message board backed by /api/blog (Cloudflare KV).
   ============================================================ */
(function () {
  'use strict';

  var form = document.getElementById('blogForm');
  if (!form) return;

  var nameInput = document.getElementById('blogName');
  var ratingInput = document.getElementById('blogRating');
  var ratingText = document.getElementById('blogRatingText');
  var dateInput = document.getElementById('blogDate');
  var locationInput = document.getElementById('blogLocation');
  var messageInput = document.getElementById('blogMessage');
  var counter = document.getElementById('blogCounter');
  var stars = Array.prototype.slice.call(document.querySelectorAll('.blog-star'));
  var submitBtn = document.getElementById('blogSubmit');
  var statusEl = document.getElementById('blogStatus');
  var postsEl = document.getElementById('blogPosts');
  var countEl = document.getElementById('blogCount');
  var moreBtn = document.getElementById('blogMore');
  var refreshBtn = document.getElementById('blogRefresh');

  var API = '/api/blog';
  var LABELS = {
    5: 'Excellent · 极好',
    4: 'Very good · 很好',
    3: 'Good · 一般',
    2: 'Fair · 欠佳',
    1: 'Poor · 差',
  };
  var renderedIds = {};
  var cursor = null;
  var busy = false;

  /* ---------------------------------------------------- helpers ---- */

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = 'blog-status' + (kind ? ' ' + kind : '');
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function nowLocalValue() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    );
  }

  function formatWhen(post) {
    if (post.dateText) return post.dateText.replace('T', ' · ');
    if (!post.publishedAt) return '';
    var d = new Date(post.publishedAt);
    if (isNaN(d.getTime())) return '';
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' (UTC' +
      (d.getTimezoneOffset() <= 0 ? '+' : '-') +
      Math.abs(d.getTimezoneOffset() / 60) + ')'
    );
  }

  function starString(rating) {
    var on = Math.max(1, Math.min(5, parseInt(rating, 10) || 0));
    var out = '';
    for (var i = 1; i <= 5; i++) {
      out += i <= on ? '★' : '<span class="off">★</span>';
    }
    return out;
  }

  /* ------------------------------------------------------ rating ---- */

  function paintStars(value) {
    stars.forEach(function (btn) {
      var v = parseInt(btn.getAttribute('data-value'), 10);
      btn.classList.toggle('on', v <= value);
      btn.setAttribute('aria-checked', v === value ? 'true' : 'false');
      btn.tabIndex = v === value ? 0 : -1;
    });
    ratingText.textContent = value + ' / 5 — ' + (LABELS[value] || '');
  }

  function setRating(value) {
    ratingInput.value = String(value);
    paintStars(value);
  }

  stars.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setRating(parseInt(btn.getAttribute('data-value'), 10));
    });
    btn.addEventListener('keydown', function (ev) {
      var v = parseInt(ratingInput.value, 10) || 5;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        setRating(Math.min(5, v + 1));
        stars[Math.min(5, v + 1) - 1].focus();
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        setRating(Math.max(1, v - 1));
        stars[Math.max(1, v - 1) - 1].focus();
      }
    });
  });

  /* ---------------------------------------------------- rendering ---- */

  function buildCard(post) {
    var card = document.createElement('article');
    card.className = 'blog-card';

    var head = document.createElement('div');
    head.className = 'blog-card-head';

    var name = document.createElement('h4');
    name.className = 'blog-card-name';
    name.textContent = post.name;
    head.appendChild(name);

    var starsEl = document.createElement('span');
    starsEl.className = 'blog-card-stars';
    starsEl.setAttribute('aria-label', post.rating + ' out of 5 stars');
    starsEl.innerHTML = starString(post.rating);
    head.appendChild(starsEl);

    card.appendChild(head);

    var metaBits = [];
    if (post.dateText || post.publishedAt) metaBits.push(formatWhen(post));
    if (post.location) metaBits.push(post.location);
    if (metaBits.length) {
      var meta = document.createElement('div');
      meta.className = 'blog-card-meta';
      metaBits.forEach(function (bit) {
        var span = document.createElement('span');
        span.textContent = bit;
        meta.appendChild(span);
      });
      card.appendChild(meta);
    }

    var body = document.createElement('p');
    body.className = 'blog-card-message';
    body.textContent = post.message;
    card.appendChild(body);

    return card;
  }

  function showNotice(text) {
    postsEl.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'blog-notice';
    p.textContent = text;
    postsEl.appendChild(p);
  }

  function setCount(total) {
    countEl.textContent = total ? total + ' message' + (total === 1 ? '' : 's') + ' · 条留言' : '';
  }

  /* ------------------------------------------------------- loading ---- */

  function load(reset) {
    if (busy) return;
    busy = true;
    if (reset) {
      cursor = null;
      renderedIds = {};
      postsEl.innerHTML = '';
      var loading = document.createElement('p');
      loading.className = 'blog-loading';
      loading.textContent = 'Loading messages… · 正在加载留言…';
      postsEl.appendChild(loading);
    }

    fetch(API + '?limit=10' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), {
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (out) {
        var data = out.data || {};
        if (out.status === 503 || data.error === 'not_configured') {
          showNotice('The readers\u2019 message board is coming online shortly — please check back soon. · 读者留言板正在开通中，稍后即可使用。');
          setCount(0);
          setStatus('Message board is coming online · 留言板开通中', 'pending');
          return;
        }
        if (!data.success) throw new Error(data.error || 'load_failed');

        if (reset) postsEl.innerHTML = '';
        var posts = data.posts || [];
        posts.forEach(function (post) {
          if (renderedIds[post.id]) return;
          renderedIds[post.id] = true;
          postsEl.appendChild(buildCard(post));
        });
        if (!postsEl.children.length) {
          var empty = document.createElement('p');
          empty.className = 'blog-empty';
          empty.textContent = 'No messages yet — be the first to share your thoughts. · 还没有留言，欢迎成为第一位分享者。';
          postsEl.appendChild(empty);
        }
        setCount(Object.keys(renderedIds).length);
        cursor = data.cursor || null;
        moreBtn.hidden = !cursor;
        refreshBtn.hidden = false;
      })
      .catch(function () {
        showNotice('Messages could not be loaded right now. Please try again in a moment. · 留言暂时加载失败，请稍后重试。');
        setStatus('Could not load messages · 加载失败', 'err');
      })
      .then(function () {
        busy = false;
      });
  }

  /* ------------------------------------------------------ posting ---- */

  function validate() {
    var ok = true;
    [nameInput, messageInput].forEach(function (el) { el.classList.remove('invalid'); });
    if (nameInput.value.trim().length < 2) { nameInput.classList.add('invalid'); ok = false; }
    if (messageInput.value.trim().length < 5) { messageInput.classList.add('invalid'); ok = false; }
    return ok;
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (busy) return;

    if (!validate()) {
      setStatus('Please add your name/title and a message. · 请填写姓名头衔与留言内容。', 'err');
      return;
    }

    busy = true;
    submitBtn.disabled = true;
    setStatus('Posting… · 正在发布…', 'pending');

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: nameInput.value.trim(),
        rating: parseInt(ratingInput.value, 10) || 5,
        dateText: dateInput.value,
        location: locationInput.value.trim(),
        message: messageInput.value.trim(),
        botcheck: !!form.querySelector('[name="botcheck"]:checked'),
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (out) {
        var data = out.data || {};
        if (out.status === 503 || data.error === 'not_configured') {
          setStatus('The readers\u2019 message board is coming online shortly · 留言板正在开通中', 'pending');
          return;
        }
        if (!data.success) {
          var msg = 'Your message could not be posted. Please try again. · 发布失败，请稍后重试。';
          if (data.error === 'rate_limited') msg = 'You just posted — please wait a minute before posting again. · 您刚刚发布过，请稍等一分钟。';
          if (data.error === 'name_required') msg = 'Please add your name and title (at least 2 characters). · 请填写姓名与头衔。';
          if (data.error === 'message_required') msg = 'Please write a message of at least 5 characters. · 留言至少 5 个字符。';
          if (data.error === 'rating_invalid') msg = 'Please choose a rating from 1 to 5 stars. · 请选择 1–5 星评分。';
          setStatus(msg, 'err');
          return;
        }

        var post = data.post;
        if (post && post.id) {
          if (!Object.keys(renderedIds).length) postsEl.innerHTML = '';
          renderedIds[post.id] = true;
          postsEl.insertBefore(buildCard(post), postsEl.firstChild);
          setCount(Object.keys(renderedIds).length);
        }
        messageInput.value = '';
        counter.textContent = '0 / 2000';
        counter.classList.remove('near-limit');
        setStatus('Thank you — your message is now public. · 感谢分享，您的留言已公开展示。', 'ok');
        var card = postsEl.firstChild;
        if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(function () {
        setStatus('Your message could not be posted. Please try again. · 发布失败，请稍后重试。', 'err');
      })
      .then(function () {
        busy = false;
        submitBtn.disabled = false;
      });
  });

  /* --------------------------------------------------- form extras ---- */

  messageInput.addEventListener('input', function () {
    var len = messageInput.value.length;
    counter.textContent = len + ' / 2000';
    counter.classList.toggle('near-limit', len > 1800);
  });

  moreBtn.addEventListener('click', function () { load(false); });
  refreshBtn.addEventListener('click', function () { load(true); });

  setRating(parseInt(ratingInput.value, 10) || 5);
  dateInput.value = nowLocalValue();
  load(true);
})();
