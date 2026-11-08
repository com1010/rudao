/**
 * RuDao.org - Board Games sound layer
 * ------------------------------------------------------------
 * All sounds are synthesised locally with the Web Audio API:
 *   - no .mp3 / .wav / .ogg files to download
 *   - no network requests, no analytics, no microphone access
 *   - nothing plays until the visitor interacts with the page
 *
 * Browsers keep an AudioContext suspended until a user gesture.
 * unlock() listens for the first pointer / key interaction, and every
 * play() call also resumes the context, so an AI reply 300ms after the
 * human's move can still be heard.
 *
 * Public API (window.RuDaoSound):
 *   play(name)         - fire a named sound (no-op if muted)
 *   setEnabled(bool)   - persist the on/off preference
 *   isEnabled()
 *   setVolume(0..1)    - persist the volume preference
 *   getVolume()
 *   debug()            - state snapshot, used by the page checks
 */
(function () {
    'use strict';

    var ON_KEY = 'rudao.games.sound.on';
    var VOL_KEY = 'rudao.games.sound.vol';
    var enabled = true;
    var volume = 0.7;
    var ctx = null;
    var master = null;
    var noiseBuf = null;
    var played = Object.create(null);

    function store(key, value) {
        try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
    }
    function load(key) {
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
    }
    var savedOn = load(ON_KEY);
    if (savedOn === '0' || savedOn === '1') enabled = savedOn === '1';
    var savedVol = parseFloat(load(VOL_KEY));
    if (isFinite(savedVol) && savedVol >= 0.1 && savedVol <= 1) volume = savedVol;

    function ensure() {
        if (!enabled) return null;
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!ctx) {
            try {
                ctx = new AC();
                master = ctx.createGain();
                master.gain.value = volume * 0.9;
                master.connect(ctx.destination);
            } catch (e) { ctx = null; return null; }
        }
        if (ctx.state !== 'running' && ctx.resume) {
            try { ctx.resume().catch(function () {}); } catch (e) { /* older Safari */ }
        }
        return ctx;
    }

    function noiseBuffer() {
        if (noiseBuf) return noiseBuf;
        var len = Math.floor(ctx.sampleRate * 0.5);
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        var data = noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return noiseBuf;
    }

    /* A short filtered noise burst: the "click" of stone on wood. */
    function noise(t, dur, peak, freq, q) {
        var src = ctx.createBufferSource();
        src.buffer = noiseBuffer();
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(freq, t);
        bp.Q.value = q || 1;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(bp); bp.connect(g); g.connect(master);
        src.start(t);
        src.stop(t + dur + 0.02);
    }

    /* A short pitched body under the click, or a bell / chime on its own. */
    function tone(freq, t, dur, peak, type, endFreq) {
        var o = ctx.createOscillator();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq, t);
        if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(master);
        o.start(t);
        o.stop(t + dur + 0.02);
    }

    function wood(t, o) {
        noise(t, o.dur || 0.07, o.peak || 0.2, o.freq || 1600, o.q || 1.1);
        tone(o.body || 210, t, (o.dur || 0.07) * 1.6, (o.peak || 0.2) * 0.55, 'triangle');
    }

    function bell(t, freq, dur, peak) {
        tone(freq, t, dur, peak, 'sine');
        tone(freq * 2.02, t, dur * 0.65, peak * 0.35, 'sine');
        tone(freq * 3.01, t, dur * 0.4, peak * 0.16, 'sine');
    }

    var SOUNDS = {
        /* WeiQi: a soft slate-and-shell "tok" */
        go: function (t) { wood(t, { freq: 1500, body: 190, peak: 0.20, dur: 0.065, q: 0.9 }); },
        'go-capture': function (t) {
            wood(t, { freq: 1500, body: 190, peak: 0.20, dur: 0.065, q: 0.9 });
            wood(t + 0.085, { freq: 2150, body: 250, peak: 0.14, dur: 0.05, q: 1.3 });
        },
        /* Xiangqi: a drier, brighter wooden clack */
        xq: function (t) { wood(t, { freq: 2350, body: 265, peak: 0.23, dur: 0.055, q: 1.35 }); },
        'xq-capture': function (t) {
            wood(t, { freq: 2350, body: 265, peak: 0.23, dur: 0.055, q: 1.35 });
            noise(t + 0.07, 0.09, 0.11, 3100, 0.8);
        },
        select: function (t) { tone(660, t, 0.045, 0.045, 'sine'); },
        pass: function (t) { wood(t, { freq: 950, body: 155, peak: 0.11, dur: 0.085, q: 0.8 }); },
        start: function (t) {
            wood(t, { freq: 1100, body: 170, peak: 0.10, dur: 0.05, q: 0.8 });
            wood(t + 0.13, { freq: 1350, body: 195, peak: 0.10, dur: 0.05, q: 0.8 });
        },
        invalid: function (t) { tone(196, t, 0.17, 0.085, 'sine', 150); },
        undo: function (t) {
            tone(520, t, 0.10, 0.065, 'sine', 390);
            tone(390, t + 0.09, 0.13, 0.055, 'sine', 300);
        },
        check: function (t) { bell(t, 740, 0.38, 0.075); },
        end: function (t) {
            var notes = [523.25, 659.25, 783.99];
            for (var i = 0; i < notes.length; i++) tone(notes[i], t + i * 0.15, 0.45, 0.075, 'sine');
            tone(261.63, t, 0.7, 0.035, 'sine');
        },
        ui: function (t) { tone(660, t, 0.09, 0.065, 'sine', 880); }
    };

    function play(name) {
        if (!enabled || !SOUNDS[name]) return false;
        var c = ensure();
        if (!c) return false;
        try {
            SOUNDS[name](c.currentTime + 0.005);
            played[name] = (played[name] || 0) + 1;
            return true;
        } catch (e) { return false; }
    }

    function unlock() {
        if (enabled) ensure();
        document.removeEventListener('pointerdown', unlock, true);
        document.removeEventListener('keydown', unlock, true);
    }
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);

    window.RuDaoSound = {
        play: play,
        isEnabled: function () { return enabled; },
        setEnabled: function (v) {
            enabled = !!v;
            store(ON_KEY, enabled ? '1' : '0');
            if (enabled) ensure();
        },
        getVolume: function () { return volume; },
        setVolume: function (v) {
            v = Math.max(0.1, Math.min(1, Number(v) || 0.7));
            volume = v;
            store(VOL_KEY, String(v));
            if (master && ctx) master.gain.setValueAtTime(volume * 0.9, ctx.currentTime);
        },
        unlock: unlock,
        sounds: Object.keys(SOUNDS),
        debug: function () {
            return {
                enabled: enabled,
                volume: volume,
                state: ctx ? ctx.state : 'none',
                played: JSON.parse(JSON.stringify(played))
            };
        }
    };
})();
