/* ============================================================
   Readers' Blog · 读者博客
   Public message board backed by /api/blog (Cloudflare KV).

   • Date / time is recorded automatically by the server — the
     reader never types it.
   • A message is published instantly, and the author keeps a
     personal token that lets them REWRITE or WITHDRAW it for
     10 minutes (countdown shown on their own card).
   ============================================================ */
(function () {
  'use strict';

  var form = document.getElementById('blogForm');
  if (!form) return;

  var nameInput = document.getElementById('blogName');
  var ratingInput = document.getElementById('blogRating');
  var ratingText = document.getElementById('blogRatingText');
  var locationInput = document.getElementById('blogLocation');
  var messageInput = document.getElementById('blogMessage');
  var counter = document.getElementById('blogCounter');
  var autoTimeEl = document.getElementById('blogAutoTime');
  var stars = Array.prototype.slice.call(document.querySelectorAll('.blog-star'));
  var submitBtn = document.getElementById('blogSubmit');
  var statusEl = document.getElementById('blogStatus');
  var postsEl = document.getElementById('blogPosts');
  var countEl = document.getElementById('blogCount');
  var moreBtn = document.getElementById('blogMore');
  var refreshBtn = document.getElementById('blogRefresh');
  var editBanner = document.getElementById('blogEditBanner');
  var editCancel = document.getElementById('blogEditCancel');
  var adminToggle = document.getElementById('blogAdminToggle');
  var adminPanel = document.getElementById('blogAdminPanel');
  var adminKey = document.getElementById('blogAdminKey');
  var adminUnlock = document.getElementById('blogAdminUnlock');
  var adminLock = document.getElementById('blogAdminLock');
  var adminStatus = document.getElementById('blogAdminStatus');

  var API = '/api/blog';
  var EDIT_WINDOW_MS = 10 * 60 * 1000;
  var TOKENS_KEY = 'rudaoBlogTokens';
  var ADMIN_KEY = 'rudaoBlogAdmin';

  var LABELS = {
    5: 'Excellent · 极好',
    4: 'Very good · 很好',
    3: 'Good · 一般',
    2: 'Fair · 欠佳',
    1: 'Poor · 差',
  };

  var renderedIds = {};
  var postCache = {};
  var cursor = null;
  var busy = false;
  var editing = null;

  /* --------------------------------------------- author admin mode ---- */
  /* A hidden moderation panel: enter the password once (kept in
     sessionStorage, so it disappears when the tab is closed) and every
     message gets a "Delete" button. */

  var adminToken = null;
  try {
    adminToken = window.sessionStorage.getItem(ADMIN_KEY) || null;
  } catch (err) {
    adminToken = null;
  }

  function saveAdminToken(value) {
    adminToken = value || null;
    try {
      if (adminToken) window.sessionStorage.setItem(ADMIN_KEY, adminToken);
      else window.sessionStorage.removeItem(ADMIN_KEY);
    } catch (err) {
      /* session storage blocked — admin mode lasts only for this page view */
    }
  }

  function setAdminStatus(text, kind) {
    if (!adminStatus) return;
    adminStatus.textContent = text || '';
    adminStatus.className = 'blog-admin-status' + (kind ? ' ' + kind : '');
  }

  function buildAdminDeleteBtn() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'blog-card-admin-del';
    btn.setAttribute('data-act', 'admin-delete');
    btn.title = 'Admin: delete this message · 管理员删除';
    btn.textContent = 'Delete · 删除';
    return btn;
  }

  function applyAdminMode() {
    postsEl.classList.toggle('blog-admin-mode', !!adminToken);
    var cards = postsEl.querySelectorAll('.blog-card');
    Array.prototype.forEach.call(cards, function (card) {
      var existing = card.querySelector('.blog-card-admin-del');
      if (adminToken && !existing) card.appendChild(buildAdminDeleteBtn());
      else if (!adminToken && existing && existing.parentNode) existing.parentNode.removeChild(existing);
    });
  }

  function openAdmin() {
    if (!adminPanel) return;
    adminPanel.hidden = false;
    if (adminToggle) adminToggle.setAttribute('aria-expanded', 'true');
    if (!adminToken && adminKey) adminKey.focus();
  }

  function closeAdmin() {
    if (!adminPanel) return;
    adminPanel.hidden = true;
    if (adminToggle) adminToggle.setAttribute('aria-expanded', 'false');
  }

  function paintAdminPanel() {
    if (!adminPanel) return;
    var on = !!adminToken;
    adminPanel.classList.toggle('unlocked', on);
    if (adminUnlock) adminUnlock.hidden = on;
    if (adminKey) adminKey.hidden = on;
    if (adminLock) adminLock.hidden = !on;
    if (on) setAdminStatus('Unlocked — delete buttons are shown on every message. · 已解锁：每条留言都有删除按钮。', 'ok');
  }

  function verifyAdmin(token) {
    return fetch(API + '?whoami=admin', {
      headers: { Accept: 'application/json', 'x-admin-token': token },
    })
      .then(parse)
      .then(function (out) {
        return out.status === 200 && out.data && out.data.admin === true;
      })
      .catch(function () {
        return false;
      });
  }

  function unlockAdmin() {
    var token = adminKey ? adminKey.value.trim() : '';
    if (!token) {
      setAdminStatus('Please type the admin password. · 请输入管理密码。', 'err');
      return;
    }
    setAdminStatus('Checking… · 正在验证…', 'pending');
    verifyAdmin(token).then(function (ok) {
      if (!ok) {
        setAdminStatus('Wrong password — nothing was unlocked. · 密码不正确，未解锁。', 'err');
        if (adminKey) {
          adminKey.value = '';
          adminKey.focus();
        }
        return;
      }
      saveAdminToken(token);
      if (adminKey) adminKey.value = '';
      paintAdminPanel();
      applyAdminMode();
      load(true);
    });
  }

  function lockAdmin() {
    saveAdminToken(null);
    paintAdminPanel();
    applyAdminMode();
    setAdminStatus('Locked — delete buttons removed. · 已锁定，删除按钮已隐藏。', 'pending');
  }

  function adminDelete(id, btn) {
    if (!adminToken) return;
    if (!window.confirm('Delete this message permanently? · 确认永久删除这条留言？')) return;
    btn.disabled = true;
    btn.textContent = '…';
    fetch(API + '?id=' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { Accept: 'application/json', 'x-admin-token': adminToken },
    })
      .then(parse)
      .then(function (out) {
        var data = out.data || {};
        if (!data.success) {
          if (out.status === 401) {
            lockAdmin();
            setAdminStatus('The admin password was rejected — please unlock again. · 管理密码无效，请重新解锁。', 'err');
          } else if (data.error === 'not_found') {
            removeCard(id);
            setCount(Object.keys(renderedIds).length);
            setAdminStatus('That message was already gone. · 该留言已不存在。', 'pending');
          } else {
            setAdminStatus('Could not delete the message. Please try again. · 删除失败，请稍后重试。', 'err');
            btn.disabled = false;
            btn.textContent = 'Delete · 删除';
          }
          return;
        }
        forgetPost(id);
        removeCard(id);
        setCount(Object.keys(renderedIds).length);
        setAdminStatus('Message deleted. · 留言已删除。', 'ok');
      })
      .catch(function () {
        setAdminStatus('Could not delete the message. Please try again. · 删除失败，请稍后重试。', 'err');
        btn.disabled = false;
        btn.textContent = 'Delete · 删除';
      });
  }

  if (adminToggle) {
    adminToggle.addEventListener('click', function () {
      if (adminPanel && !adminPanel.hidden) closeAdmin();
      else openAdmin();
    });
  }
  if (adminUnlock) adminUnlock.addEventListener('click', unlockAdmin);
  if (adminLock) adminLock.addEventListener('click', lockAdmin);
  if (adminKey) {
    adminKey.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        unlockAdmin();
      }
    });
  }

  /* -------------------------------------------- author token store ---- */
  /* After posting we keep the one-off token in localStorage so this browser
     can still withdraw / rewrite its own message for the next 10 minutes. */

  var LS_OK = true;
  try {
    window.localStorage.setItem('__rb_probe', '1');
    window.localStorage.removeItem('__rb_probe');
  } catch (err) {
    LS_OK = false;
  }

  function loadTokens() {
    if (!LS_OK) return {};
    try {
      var raw = window.localStorage.getItem(TOKENS_KEY);
      var stored = raw ? JSON.parse(raw) : null;
      if (!stored || typeof stored !== 'object') return {};
      var out = {};
      var cutoff = Date.now() - 86400000;
      Object.keys(stored).forEach(function (id) {
        var rec = stored[id];
        if (rec && rec.t && Number(rec.exp) > cutoff) out[id] = rec;
      });
      return out;
    } catch (err) {
      return {};
    }
  }

  var tokens = loadTokens();

  function saveTokens() {
    if (!LS_OK) return;
    try {
      window.localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    } catch (err) {
      /* storage full or blocked — controls simply won't reappear later */
    }
  }

  function rememberPost(post, token) {
    if (!post || !post.id || !token) return;
    var exp = Number(post.createdAt) || Date.now();
    tokens[post.id] = { t: token, exp: exp + EDIT_WINDOW_MS };
    saveTokens();
  }

  function forgetPost(id) {
    if (tokens[id]) {
      delete tokens[id];
      saveTokens();
    }
  }

  function ownToken(id) {
    var rec = tokens[id];
    return rec ? rec.t : null;
  }

  function timeLeft(post) {
    if (!tokens[post.id]) return 0;
    return (Number(post.createdAt) || 0) + EDIT_WINDOW_MS - Date.now();
  }

  /* ------------------------------------------------------- helpers ---- */

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = 'blog-status' + (kind ? ' ' + kind : '');
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function offsetLabel(d) {
    var off = -d.getTimezoneOffset() / 60;
    var sign = off >= 0 ? '+' : '-';
    var abs = Math.abs(off);
    return 'GMT' + sign + (abs % 1 === 0 ? String(abs) : abs.toFixed(1));
  }

  function stamp(d) {
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' (' + offsetLabel(d) + ')'
    );
  }

  /* The date / time is automatic: the reader sees their own clock. */
  function paintAutoTime() {
    if (autoTimeEl) autoTimeEl.textContent = stamp(new Date());
  }

  function formatWhen(post) {
    var ms = Number(post.createdAt);
    if (!isFinite(ms) && post.publishedAt) ms = Date.parse(post.publishedAt);
    if (!isFinite(ms)) return post.dateText ? String(post.dateText).replace('T', ' · ') : '';
    return stamp(new Date(ms));
  }

  function fmtLeft(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(total / 60) + ':' + pad(total % 60);
  }

  function starString(rating) {
    var on = Math.max(1, Math.min(5, parseInt(rating, 10) || 0));
    var out = '';
    for (var i = 1; i <= 5; i++) {
      out += i <= on ? '★' : '<span class="off">★</span>';
    }
    return out;
  }

  function parse(res) {
    return res.json().then(function (data) {
      return { status: res.status, data: data };
    });
  }

  /* ------------------------------------------------------ rating ---- */

  function paintStars(value, preview) {
    stars.forEach(function (btn) {
      var v = parseInt(btn.getAttribute('data-value'), 10);
      btn.classList.toggle('on', v <= value);
      if (!preview) {
        btn.setAttribute('aria-checked', v === value ? 'true' : 'false');
        btn.tabIndex = v === value ? 0 : -1;
      }
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
    });    btn.addEventListener('keydown', function (ev) {
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

  /* Hovering the gold bar previews the score, so it is obvious it is clickable. */
  (function () {
    var starBox = document.getElementById('blogStars');
    if (!starBox) return;
    starBox.addEventListener('mouseover', function (ev) {
      var hit = ev.target && ev.target.closest ? ev.target.closest('.blog-star') : null;
      if (hit) paintStars(parseInt(hit.getAttribute('data-value'), 10), true);
    });
    starBox.addEventListener('mouseleave', function () {
      paintStars(parseInt(ratingInput.value, 10) || 5);
    });
  })();

  /* --------------------------------------- own-post control bar ---- */

  function buildOwnBar(post) {
    var bar = document.createElement('div');
    bar.className = 'blog-card-own';
    bar.setAttribute('data-post-id', post.id);
    bar.setAttribute('data-exp', String((Number(post.createdAt) || Date.now()) + EDIT_WINDOW_MS));

    var label = document.createElement('span');
    label.className = 'blog-card-own-label';
    label.textContent = 'Yours · 我的留言';
    bar.appendChild(label);

    var timer = document.createElement('span');
    timer.className = 'blog-card-timer';
    timer.textContent = fmtLeft(timeLeft(post)) + ' left · 剩余';
    bar.appendChild(timer);

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'blog-card-btn';
    editBtn.setAttribute('data-act', 'edit');
    editBtn.textContent = 'Rewrite · 修改重发';
    bar.appendChild(editBtn);

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'blog-card-btn blog-card-btn-danger';
    delBtn.setAttribute('data-act', 'withdraw');
    delBtn.textContent = 'Withdraw Message · 撤回留言';
    bar.appendChild(delBtn);

    return bar;
  }

  function dropOwnControls(id) {
    var card = postsEl.querySelector('.blog-card[data-post-id="' + id + '"]');
    if (!card) return;
    var bar = card.querySelector('.blog-card-own');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    card.classList.remove('blog-card-owned');
  }

  /* ---------------------------------------------------- rendering ---- */

  function buildCard(post) {
    var card = document.createElement('article');
    card.className = 'blog-card';
    card.setAttribute('data-post-id', post.id);

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
    var when = formatWhen(post);
    if (when) metaBits.push(when + (post.updatedAt ? ' · edited 已修改' : ''));
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

    if (tokens[post.id] && timeLeft(post) > 0) {
      card.classList.add('blog-card-owned');
      card.appendChild(buildOwnBar(post));
    }

    if (adminToken) {
      card.classList.add('blog-card-has-admin');
      card.appendChild(buildAdminDeleteBtn());
    }

    return card;
  }

  function placeCard(post) {
    var existing = postsEl.querySelector('.blog-card[data-post-id="' + post.id + '"]');
    var fresh = buildCard(post);
    if (existing) {
      existing.parentNode.replaceChild(fresh, existing);
    } else {
      var empty = postsEl.querySelector('.blog-empty, .blog-notice, .blog-loading');
      if (empty) postsEl.removeChild(empty);
      postsEl.insertBefore(fresh, postsEl.firstChild);
    }
    renderedIds[post.id] = true;
    postCache[post.id] = post;
    return fresh;
  }

  function removeCard(id) {
    var card = postsEl.querySelector('.blog-card[data-post-id="' + id + '"]');
    if (card && card.parentNode) card.parentNode.removeChild(card);
    delete renderedIds[id];
    delete postCache[id];
    if (!postsEl.children.length) {
      var empty = document.createElement('p');
      empty.className = 'blog-empty';
      empty.textContent = 'No messages yet — be the first to share your thoughts. · 还没有留言，欢迎成为第一位分享者。';
      postsEl.appendChild(empty);
    }
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
      postCache = {};
      postsEl.innerHTML = '';
      var loading = document.createElement('p');
      loading.className = 'blog-loading';
      loading.textContent = 'Loading messages… · 正在加载留言…';
      postsEl.appendChild(loading);
    }

    fetch(API + '?limit=10' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), {
      headers: { Accept: 'application/json' },
    })
      .then(parse)
      .then(function (out) {
        var data = out.data || {};
        if (out.status === 503 || data.error === 'not_configured') {
          showNotice('The readers\u2019 message board is coming online shortly — please check back soon. · 读者留言板正在开通中，稍后即可使用。');
          setCount(0);
          setStatus('Message board is coming online · 留言板开通中', 'pending');
          return;
        }
        if (!data.success) throw new Error(data.error || 'load_failed');
        if (Number(data.editWindowMs) > 0) EDIT_WINDOW_MS = Number(data.editWindowMs);

        if (reset) postsEl.innerHTML = '';
        var posts = data.posts || [];
        posts.forEach(function (post) {
          if (renderedIds[post.id]) return;
          renderedIds[post.id] = true;
          postCache[post.id] = post;
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

  /* --------------------------------------------------- edit / post ---- */

  function updateCounter() {
    var len = messageInput.value.length;
    counter.textContent = len + ' / 2000';
    counter.classList.toggle('near-limit', len > 1800);
  }

  function validate() {
    var ok = true;
    [nameInput, messageInput].forEach(function (el) { el.classList.remove('invalid'); });
    if (nameInput.value.trim().length < 2) { nameInput.classList.add('invalid'); ok = false; }
    if (messageInput.value.trim().length < 5) { messageInput.classList.add('invalid'); ok = false; }
    return ok;
  }

  function startEdit(id) {
    var post = postCache[id];
    if (!post || !ownToken(id)) return;
    if (timeLeft(post) <= 0) {
      setStatus('The 10-minute window has closed — this message can no longer be rewritten. · 已超过 10 分钟，无法修改。', 'err');
      dropOwnControls(id);
      return;
    }
    editing = id;
    nameInput.value = post.name || '';
    setRating(parseInt(post.rating, 10) || 5);
    locationInput.value = post.location || '';
    messageInput.value = post.message || '';
    updateCounter();
    editBanner.hidden = false;
    submitBtn.textContent = 'Update Message · 更新留言';
    setStatus('Editing your message — press “Update Message” to save it. · 正在修改，完成后请点「更新留言」。', 'pending');
    try {
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      form.scrollIntoView();
    }
    try {
      messageInput.focus({ preventScroll: true });
    } catch (err) {
      messageInput.focus();
    }
  }

  function cancelEdit(clearForm) {
    editing = null;
    editBanner.hidden = true;
    submitBtn.textContent = 'Post Message · 发布留言';
    if (clearForm) {
      messageInput.value = '';
      updateCounter();
    }
  }

  editCancel.addEventListener('click', function () {
    cancelEdit(false);
    setStatus('Edit cancelled — your published message is unchanged. · 已取消修改，原留言保持不变。', 'pending');
  });

  function submit() {
    if (busy) return;

    if (!validate()) {
      setStatus('Please add your name/title and a message. · 请填写姓名头衔与留言内容。', 'err');
      return;
    }

    var isEdit = !!editing && !!ownToken(editing);
    var url = API;
    var method = 'POST';
    var headers = { 'Content-Type': 'application/json', Accept: 'application/json' };

    if (isEdit) {
      url = API + '?id=' + encodeURIComponent(editing);
      method = 'PATCH';
      headers['x-edit-token'] = ownToken(editing);
    }

    busy = true;
    submitBtn.disabled = true;
    setStatus(isEdit ? 'Updating… · 正在更新…' : 'Posting… · 正在发布…', 'pending');

    fetch(url, {
      method: method,
      headers: headers,
      body: JSON.stringify({
        name: nameInput.value.trim(),
        rating: parseInt(ratingInput.value, 10) || 5,
        location: locationInput.value.trim(),
        message: messageInput.value.trim(),
        botcheck: !!form.querySelector('[name="botcheck"]:checked'),
      }),
    })
      .then(parse)
      .then(function (out) {
        var data = out.data || {};

        if (out.status === 503 || data.error === 'not_configured') {
          setStatus('The readers\u2019 message board is coming online shortly · 留言板正在开通中', 'pending');
          return;
        }

        if (!data.success) {
          if (data.error === 'window_expired') {
            var expiredId = editing || (data.post && data.post.id);
            if (expiredId) { forgetPost(expiredId); dropOwnControls(expiredId); }
            cancelEdit(false);
            setStatus('The 10-minute window has closed, so your change was not saved. You can post it as a new message. · 已超过 10 分钟，修改未保存；您可以作为新留言发布。', 'err');
            return;
          }
          var msg = isEdit
            ? 'Your message could not be updated. Please try again. · 更新失败，请稍后重试。'
            : 'Your message could not be posted. Please try again. · 发布失败，请稍后重试。';
          if (data.error === 'rate_limited') msg = 'You just posted — please wait a minute before posting again. · 您刚刚发布过，请稍等一分钟。';
          if (data.error === 'name_required') msg = 'Please add your name and title (at least 2 characters). · 请填写姓名与头衔。';
          if (data.error === 'message_required') msg = 'Please write a message of at least 5 characters. · 留言至少 5 个字符。';
          if (data.error === 'rating_invalid') msg = 'Please choose a rating from 1 to 5 stars. · 请选择 1–5 星评分。';
          if (data.error === 'unauthorized') msg = 'This message is no longer editable from this browser. · 该留言已无法在本设备上修改。';
          if (data.error === 'not_found') msg = 'This message no longer exists on the board. · 该留言已不在留言板上。';
          setStatus(msg, 'err');
          return;
        }

        var post = data.post;

        if (isEdit) {
          if (post && post.id) {
            rememberPost(post, ownToken(post.id) || headers['x-edit-token']);
            var card = placeCard(post);
            if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          cancelEdit(true);
          setStatus('Updated — your revised message is now public. · 已更新，修改后的留言已公开展示。', 'ok');
          return;
        }

        if (post && post.id) {
          rememberPost(post, data.token);
          placeCard(post);
          setCount(Object.keys(renderedIds).length);
          var fresh = postsEl.querySelector('.blog-card[data-post-id="' + post.id + '"]');
          if (fresh && fresh.scrollIntoView) fresh.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        messageInput.value = '';
        updateCounter();
        setStatus('Thank you — your message is now public. You can withdraw or rewrite it for 10 minutes. · 感谢分享，您的留言已公开；10 分钟内可撤回或修改。', 'ok');
      })
      .catch(function () {
        setStatus('Your message could not be saved. Please try again. · 保存失败，请稍后重试。', 'err');
      })
      .then(function () {
        busy = false;
        submitBtn.disabled = false;
      });
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    submit();
  });

  /* --------------------------------------------- card actions ---- */

  postsEl.addEventListener('click', function (ev) {
    var target = ev.target;
    if (!target || !target.closest) return;

    var delBtn = target.closest('.blog-card-admin-del');
    if (delBtn) {
      var delCard = delBtn.closest('.blog-card');
      if (delCard) adminDelete(delCard.getAttribute('data-post-id'), delBtn);
      return;
    }

    var btn = target.closest('.blog-card-btn');
    if (!btn) return;
    var bar = btn.closest('.blog-card-own');
    var id = bar ? bar.getAttribute('data-post-id') : null;
    if (!id) return;
    if (btn.getAttribute('data-act') === 'edit') {
      startEdit(id);
    } else {
      withdraw(id, btn);
    }
  });

  function withdraw(id, btn) {
    var token = ownToken(id);
    if (!token) {
      setStatus('This message can no longer be withdrawn. · 该留言已超过可撤回时间。', 'err');
      dropOwnControls(id);
      return;
    }
    if (!window.confirm('Withdraw this message? It will be removed from the board. · 确认撤回这条留言？留言将从留言板移除。')) return;

    var saved = postCache[id];
    btn.disabled = true;
    setStatus('Withdrawing… · 正在撤回…', 'pending');

    fetch(API + '?id=' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { Accept: 'application/json', 'x-edit-token': token },
    })
      .then(parse)
      .then(function (out) {
        var data = out.data || {};
        if (!data.success) {
          if (data.error === 'window_expired') {
            forgetPost(id);
            dropOwnControls(id);
            setStatus('The 10-minute window has closed — this message can no longer be withdrawn. · 已超过 10 分钟，无法撤回。', 'err');
          } else if (data.error === 'not_found') {
            forgetPost(id);
            removeCard(id);
            setCount(Object.keys(renderedIds).length);
            setStatus('That message is already gone. · 该留言已不存在。', 'pending');
          } else if (out.status === 503) {
            setStatus('The message board is coming online · 留言板开通中', 'pending');
          } else {
            setStatus('Could not withdraw the message. Please try again. · 撤回失败，请稍后重试。', 'err');
          }
          return;
        }

        forgetPost(id);
        removeCard(id);
        if (editing === id) cancelEdit(false);
        setCount(Object.keys(renderedIds).length);

        // Hand the text back so a re-post is one click away.
        if (saved) {
          nameInput.value = saved.name || nameInput.value;
          setRating(parseInt(saved.rating, 10) || 5);
          locationInput.value = saved.location || '';
          messageInput.value = saved.message || messageInput.value;
          updateCounter();
        }
        setStatus('Message withdrawn. Edit it above and post again whenever you like. · 留言已撤回；您可修改后随时重新发布。', 'ok');
      })
      .catch(function () {
        setStatus('Could not withdraw the message. Please try again. · 撤回失败，请稍后重试。', 'err');
      })
      .then(function () {
        btn.disabled = false;
      });
  }

  /* ------------------------------------------- 10-minute countdown ---- */

  function tick() {
    var bars = postsEl.querySelectorAll('.blog-card-own');
    Array.prototype.forEach.call(bars, function (bar) {
      var id = bar.getAttribute('data-post-id');
      var exp = parseInt(bar.getAttribute('data-exp'), 10);
      var left = exp - Date.now();
      if (!id || isNaN(exp)) return;

      if (left <= 0) {
        forgetPost(id);
        dropOwnControls(id);
        if (editing === id) {
          cancelEdit(false);
          setStatus('The 10-minute editing window has closed. · 10 分钟修改时间已结束。', 'pending');
        }
        return;
      }
      var timer = bar.querySelector('.blog-card-timer');
      if (timer) timer.textContent = fmtLeft(left) + ' left · 剩余';
    });
  }

  /* --------------------------------------------------- form extras ---- */

  messageInput.addEventListener('input', updateCounter);

  moreBtn.addEventListener('click', function () { load(false); });
  refreshBtn.addEventListener('click', function () { load(true); });

  setRating(parseInt(ratingInput.value, 10) || 5);
  paintAutoTime();
  window.setInterval(paintAutoTime, 20000);
  window.setInterval(tick, 1000);

  // A password remembered in this tab is re-checked quietly on every visit.
  if (adminToken) {
    verifyAdmin(adminToken).then(function (ok) {
      if (!ok) {
        saveAdminToken(null);
        paintAdminPanel();
        applyAdminMode();
      }
    });
  }
  paintAdminPanel();
  load(true);
})();
