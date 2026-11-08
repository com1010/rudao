/**
 * RuDao.org - Board Games bilingual spoken cues
 * ------------------------------------------------------------
 * Teaches the vocabulary of the two boards by speaking a short Chinese
 * term and then its English equivalent at key moments:
 *   落子 place a stone / 提子 capture / 将军 check / 将死 checkmate / 终局 end
 *
 * Uses the browser's built-in speechSynthesis (text-to-speech) only.
 * It never calls SpeechRecognition / getUserMedia: the microphone is
 * never opened or requested. No audio files and no network requests are
 * made by this file; voices are supplied by the visitor's own device.
 *
 * Cues are queued, not cancelled: a capture followed immediately by a
 * check still pronounces both words. The queue keeps only the latest
 * three cues so a long game cannot build up an audio backlog.
 *
 * Public API (window.RuDaoVoice):
 *   cue(name, ctx)          - speak a named cue
 *   setEnabled / isEnabled
 *   setLang / getLang       - 'both' | 'zh' | 'en'
 *   setScope / getScope     - 'all' | 'key' (key suppresses ordinary moves)
 *   onStatus(fn)            - voice availability updates
 *   status() / debug()
 */
(function () {
    'use strict';

    var ON_KEY = 'rudao.games.voice.on';
    var LANG_KEY = 'rudao.games.voice.lang';
    var SCOPE_KEY = 'rudao.games.voice.scope';
    var synth = window.speechSynthesis || null;
    var Utter = window.SpeechSynthesisUtterance || null;
    var supported = !!(synth && Utter);
    var enabled = true;
    var lang = 'both';
    var scope = 'all';
    var queue = [];
    var running = false;
    var token = 0;
    var fallback = null;
    var spoken = Object.create(null);
    var utterances = 0;
    var listeners = [];

    function store(key, value) {
        try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
    }
    function load(key) {
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
    }
    var savedOn = load(ON_KEY);
    if (savedOn === '0' || savedOn === '1') enabled = savedOn === '1';
    var savedLang = load(LANG_KEY);
    if (savedLang === 'both' || savedLang === 'zh' || savedLang === 'en') lang = savedLang;
    var savedScope = load(SCOPE_KEY);
    if (savedScope === 'all' || savedScope === 'key') scope = savedScope;

    /* --------------------------------------------------------
       Phrases. English is spoken with an English voice, Chinese
       with a Chinese voice when the device provides one.
       -------------------------------------------------------- */
    function build(name, ctx) {
        ctx = ctx || {};
        var r = ctx.result || {};
        var w = ctx.winner || '';
        var cnWin = w === 'Black' ? '黑胜' : w === 'White' ? '白胜' : w === 'Red' ? '红胜' : '';
        switch (name) {
            case 'ready':
                return { zh: '双语语音已开启', en: 'Bilingual voices on' };
            case 'start':
                return { zh: '开局', en: 'New game' };
            case 'move':
                return ctx.game === 'go'
                    ? { zh: '落子', en: 'Stone placed' }
                    : { zh: '落子', en: 'Move' };
            case 'capture':
                return ctx.game === 'go'
                    ? { zh: '提子', en: 'Capture' }
                    : { zh: '吃子', en: 'Capture' };
            case 'select':
                return { zh: '选子', en: 'Piece selected' };
            case 'check':
                return { zh: '将军', en: 'Check' };
            case 'checkmate':
                return { zh: '将死,终局', en: 'Checkmate. Game over.' };
            case 'pass':
                return { zh: '停一手', en: 'Pass' };
            case 'invalid':
                return { zh: '此手不可下', en: 'Illegal move' };
            case 'undo':
                return { zh: '悔棋', en: 'Undo' };
            case 'end':
                if (r.reason === 'checkmate') return { zh: '将死,终局', en: 'Checkmate. Game over.' };
                if (r.reason === 'stalemate') return { zh: '困毙,终局', en: 'Stalemate. Game over.' };
                if (r.resigned) return { zh: '认负,终局', en: 'Resignation. Game over.' };
                if (w) return { zh: '终局,' + cnWin, en: 'Game over. ' + w + ' wins.' };
                return { zh: '终局', en: 'Game over.' };
        }
        return null;
    }

    function voices() {
        var vs = [];
        try { vs = synth ? (synth.getVoices() || []) : []; } catch (e) { vs = []; }
        var hasEn = false, hasZh = false;
        for (var i = 0; i < vs.length; i++) {
            var code = vs[i].lang || '';
            if (/^en/i.test(code)) hasEn = true;
            if (/^(zh|cmn)/i.test(code)) hasZh = true;
        }
        return { en: hasEn, zh: hasZh, total: vs.length };
    }

    function pick(l) {
        var vs = [];
        try { vs = synth.getVoices() || []; } catch (e) { return null; }
        var wide = l === 'zh' ? /^(zh|cmn)/i : /^en/i;
        var exact = l === 'zh' ? /^zh(-|_)?(CN|Hans)/i : /^en(-|_)?(US|GB)/i;
        var fallbackVoice = null;
        for (var i = 0; i < vs.length; i++) {
            var v = vs[i], code = v.lang || '';
            if (!wide.test(code)) continue;
            if (!fallbackVoice) fallbackVoice = v;
            if (exact.test(code) && v.localService) return v;
        }
        return fallbackVoice;
    }

    function status() {
        var v = voices();
        return { supported: supported, en: v.en, zh: v.zh, total: v.total };
    }
    function notify() {
        var s = status();
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](s); } catch (e) { /* keep the game running */ }
        }
    }
    if (supported && synth.addEventListener) {
        try { synth.addEventListener('voiceschanged', notify); } catch (e) { /* older browsers */ }
    }

    function finish(my) {
        if (my !== token) return;
        if (fallback) { window.clearTimeout(fallback); fallback = null; }
        running = false;
        pump();
    }

    function pump() {
        if (running || !queue.length || !enabled || !supported) return;
        var item = queue.shift();
        running = true;
        var my = ++token;
        var seq = item.seq, pair = item.pair;
        var queued = 0;
        for (var i = 0; i < seq.length; i++) {
            var l = seq[i];
            try {
                var u = new Utter(pair[l]);
                u.lang = l === 'zh' ? 'zh-CN' : 'en-US';
                /* A device may list a voice object the browser refuses to
                   assign. Keep the default voice and still speak the word. */
                try { var v = pick(l); if (v) u.voice = v; } catch (e) { /* keep default */ }
                u.rate = l === 'zh' ? 0.86 : 0.92;
                u.pitch = 1;
                u.volume = 0.95;
                if (i === seq.length - 1) {
                    u.onend = function () { finish(my); };
                    u.onerror = function () { finish(my); };
                }
                synth.speak(u);
                utterances++;
                queued++;
            } catch (e) { /* one voice failed, keep the other */ }
        }
        try { synth.resume(); } catch (e) { /* not paused */ }
        if (!queued) { running = false; pump(); return; }
        /* Some browsers never fire onend in the background. */
        fallback = window.setTimeout(function () { finish(my); }, 1800 + seq.length * 1400);
    }

    function cue(name, ctx) {
        if (!enabled || !supported) return false;
        if (scope === 'key' && (name === 'move' || name === 'select')) return false;
        var pair = build(name, ctx);
        if (!pair) return false;
        var seq = lang === 'both' ? ['zh', 'en'] : [lang];
        queue.push({ name: name, pair: pair, seq: seq });
        while (queue.length > 3) queue.shift();
        spoken[name] = (spoken[name] || 0) + 1;
        pump();
        return true;
    }

    function clear() {
        queue.length = 0;
        token++;
        running = false;
        if (fallback) { window.clearTimeout(fallback); fallback = null; }
        if (synth) { try { synth.cancel(); } catch (e) { /* nothing to cancel */ } }
    }

    window.RuDaoVoice = {
        cue: cue,
        isEnabled: function () { return enabled; },
        setEnabled: function (v) {
            enabled = !!v;
            store(ON_KEY, enabled ? '1' : '0');
            if (!enabled) clear();
        },
        getLang: function () { return lang; },
        setLang: function (v) { if (v === 'both' || v === 'zh' || v === 'en') { lang = v; store(LANG_KEY, v); } },
        getScope: function () { return scope; },
        setScope: function (v) { if (v === 'all' || v === 'key') { scope = v; store(SCOPE_KEY, v); } },
        onStatus: function (fn) { if (typeof fn === 'function') { listeners.push(fn); fn(status()); } },
        status: status,
        phrases: ['ready', 'start', 'move', 'capture', 'check', 'checkmate', 'end', 'pass', 'invalid', 'undo'],
        debug: function () {
            return {
                supported: supported, enabled: enabled, lang: lang, scope: scope,
                voices: voices(), spoken: JSON.parse(JSON.stringify(spoken)),
                utterances: utterances, queued: queue.length
            };
        }
    };
})();
