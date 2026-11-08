/**
 * RuDao.org - Board Games page glue
 * ------------------------------------------------------------
 * Tabs, controls, status, move log, and "Tony's table" commentary.
 * The two engines live in js/go.js and js/xiangqi.js.
 *
 * Every Chinese run is wrapped in <span class="zh"> so the site-wide
 * rule (CJK 3pt smaller than adjacent English, never bold) is kept.
 * Board piece glyphs inside the SVG are game symbols, not prose - they
 * are inside [data-no-zh] and deliberately keep their designed size.
 */
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function zh(s) { return '<span class="zh">' + s + '</span>'; }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    }); }

    /* --------------------------------------------------------
       Tony's table - reflections drawn from RuDao, especially
       Chapter 4.3. These are paraphrases, not verbatim quotes.
       -------------------------------------------------------- */
    var LINES = {
        start: [
            { en: 'A game is a refined pastime. Its worth lies in self-restraint and mutual respect.', zh: '对局本是雅事,贵在守礼自持。', ref: 'Chapter 4.3 - Board Game Manners to Boardroom Success' },
            { en: 'Before you move, set your character right. Before you compete, practice LiYi.', zh: '落子之前,先正棋品;博弈之前,先守礼仪。', ref: 'Chapter 4.3 - LiYi 礼仪' },
            { en: 'The board tests the mind and tempers the heart. Take your time.', zh: '棋枰之上,考校的是心智,磨炼的是心性。', ref: 'Chapter 4.3 - The Art of the Board' }
        ],
        move: [
            { en: 'Every negotiation is a BoYi - a strategic contest. An opponent may yet become an ally.', zh: '每一场谈判都是一次博弈,对手可能成为盟友。', ref: 'Chapter 4.2 - Co-opetition 竞合' },
            { en: 'The board is a mirror. How you behave under pressure is who you are in the boardroom.', zh: '棋盘是一面镜子,压力之下的举止照见为人。', ref: 'Chapter 4.3 - From the Board to the Boardroom' },
            { en: 'Righteousness and profit coexist. A good move is one you can still defend next year.', zh: '义利共存。好棋是明年仍站得住脚的一手。', ref: 'Chapter 1 - Roots of Profit 源' },
            { en: 'Win-win alliances are the foundation of lasting success. Do not win the point and lose the partner.', zh: '共赢联盟是长久成功的根基。', ref: 'RuDao - Three Principles' },
            { en: 'Confucian ethics supplies the boundary; Daoist philosophy supplies the momentum.', zh: '儒家伦理提供边界,道家哲学提供势能。', ref: 'Chapter 4.3 - Chapter Summary' }
        ],
        capture: [
            { en: 'To subdue the enemy without fighting is the height of skill - but RuDao asks what comes after the war.', zh: '不战而屈人之兵,善之善者也;儒道问的是战之后。', ref: 'Chapter 4.3 - Chapter Review' },
            { en: 'The strategist wins battles and inherits enemies. The RuJiang converts an enemy into a partner.', zh: '兵家胜战而树敌,儒将化敌为友。', ref: 'Chapter 4.3 - Chapter Review' },
            { en: 'A contest is never only about winning and losing. Character is revealed at the board.', zh: '博弈从来不仅关乎输赢,棋品即是人品。', ref: 'Chapter 4.3 - From the Board to the Boardroom' }
        ],
        check: [
            { en: 'Pressure is the moment that reveals character. Keep your composure under attack.', zh: '压力之下的那一刻,最能照见人品。', ref: 'Chapter 4.3 - The Boardroom Is a Board' },
            { en: 'The leader who keeps his composure under attack is practicing LiYi at the highest level.', zh: '在攻击之下保持镇定,是最高层次的礼仪。', ref: 'Chapter 4.3 - The Boardroom Is a Board' }
        ],
        pass: [
            { en: 'Restraint is a move too. A contest has its integrity; a person has his virtue.', zh: '克制也是一手。棋有棋品,人有人德。', ref: 'Chapter 4.3 - Ritual as Boundary' },
            { en: 'Knowing when not to press an advantage is part of manners at the board.', zh: '知止,是棋礼的一部分。', ref: 'Chapter 4.3 - LiYi 礼仪' }
        ],
        invalid: [
            { en: 'A rule is a boundary we accept voluntarily. Choose another point.', zh: '规则是我们自愿接受的边界。', ref: 'Chapter 4.3 - Ritual as Boundary' },
            { en: 'No need to force it. The board rewards patience before cleverness.', zh: '不必强求,棋盘先奖励耐心。', ref: 'Chapter 4.3 - The Art of the Board' }
        ],
        undo: [
            { en: 'Take your time. The board remembers, but it does not hurry.', zh: '慢慢来,棋盘记得,却不催人。', ref: 'Chapter 4.3 - LiYi 礼仪' }
        ],
        end: [
            { en: 'A contest is never only about winning and losing: character is revealed at the board.', zh: '棋品即是人品,对局即是对心。', ref: 'Chapter 4.3 - From the Board to the Boardroom' },
            { en: 'Strategy without a foundation of virtue will destroy itself. Well played - on both sides.', zh: '缺失德行根基的计谋必将走向自我毁灭。', ref: 'Chapter 4.3 - Closing Lines' }
        ]
    };
    var cursor = Object.create(null);

    function say(kind) {
        var arr = LINES[kind] || LINES.move;
        var i = cursor[kind] || 0;
        var line = arr[i % arr.length];
        cursor[kind] = i + 1;
        $('tony-en').textContent = line.en;
        $('tony-zh').innerHTML = zh(line.zh);
        $('tony-ref').textContent = line.ref;
        var card = $('tonyCard');
        card.animate ? card.animate(
            [{ opacity: .45, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }],
            { duration: 320, easing: 'ease-out' }
        ) : null;
    }

    /* --------------------------------------------------------
       Shared status / log helpers
       -------------------------------------------------------- */
    function setStatus(id, html, tone) {
        var el = $(id);
        el.innerHTML = html;
        el.className = 'gm-status' + (tone ? ' is-' + tone : '');
    }

    function addLog(id, html, isAi) {
        var ol = $(id);
        var li = document.createElement('li');
        li.innerHTML = html;
        if (isAi) li.className = 'is-ai';
        ol.insertBefore(li, ol.firstChild);
        while (ol.children.length > 9) ol.removeChild(ol.lastChild);
    }

    function clearLog(id) { $(id).innerHTML = ''; }

    /* --------------------------------------------------------
       Board sounds - synthesised locally by js/game-sound.js.
       The module is optional: if it fails to load, the boards
       simply stay silent and everything else keeps working.
       -------------------------------------------------------- */
    var Sound = window.RuDaoSound || null;
    function snd(name, delay) {
        if (!Sound) return;
        if (delay) window.setTimeout(function () { Sound.play(name); }, delay);
        else Sound.play(name);
    }

    var GO_LETTERS = 'ABCDEFGHJKLMNOPQRST';
    function goCoord(x, y, size) { return GO_LETTERS.charAt(x) + (size - y); }
    function goSide(c) { return c === 1 ? 'Black' : 'White'; }

    function goResult(r) {
        if (!r) return 'Game over.';
        if (r.resigned) return goSide(r.winner) + ' wins by resignation. ' + zh('对方认负。');
        var winner = goSide(r.winner);
        return 'Final count - Black ' + r.black + ', White ' + r.white + ' (komi ' + r.komi + '). ' +
            winner + ' wins by ' + r.margin + ' points. ' + zh('终局数目,白棋贴目 6.5。');
    }

    function xqSide(c) { return c === 'r' ? 'Red' : 'Black'; }
    function xqResult(r) {
        if (!r) return 'Game over.';
        var w = xqSide(r.winner);
        if (r.resigned) return w + ' wins by resignation. ' + zh('对方认负。');
        if (r.reason === 'checkmate') return w + ' wins by checkmate. ' + zh('将死,棋局终。');
        if (r.reason === 'stalemate') return w + ' wins - no legal move remains. ' + zh('无棋可走,困毙。');
        return w + ' wins.';
    }

    /* --------------------------------------------------------
       Go panel
       -------------------------------------------------------- */
    var go = null;
    function goStatus(extra) {
        var s = go.getState();
        if (s.over) { setStatus('go-status', goResult(s.result), 'over'); return; }
        var who = goSide(s.turn);
        var mine = go.getMode() === 'local' || s.turn === go.getHuman();
        var msg = 'Move ' + (s.moveNo + 1) + ' - ' + who + ' to play. Captures: Black ' +
            s.captures[1] + ', White ' + s.captures[2] + '.';
        if (extra) msg += ' ' + extra;
        else if (!mine) msg += ' Tony is considering the position.';
        setStatus('go-status', msg, mine ? '' : 'alert');
    }

    function onGoEvent(e) {
        var s;
        switch (e.kind) {
            case 'start':
                clearLog('go-log');
                say('start');
                snd('start');
                goStatus();
                break;
            case 'thinking':
                goStatus();
                break;
            case 'move':
                s = go.getState();
                addLog('go-log', (e.by === 'ai' ? 'Tony' : 'You') + ' ' + goSide(s.turn === 1 ? 2 : 1) +
                    ' ' + goCoord(e.x, e.y, s.size) + (e.captured ? ' +' + e.captured : ''), e.by === 'ai');
                say(e.captured ? 'capture' : 'move');
                snd(e.captured ? 'go-capture' : 'go');
                goStatus();
                break;
            case 'pass':
                addLog('go-log', (e.by === 'ai' ? 'Tony' : 'You') + ' passed', e.by === 'ai');
                say('pass');
                snd('pass');
                if (e.ended) setStatus('go-status', goResult(go.getState().result), 'over');
                else goStatus();
                break;
            case 'invalid':
                setStatus('go-status', esc(e.reason), 'alert');
                say('invalid');
                snd('invalid');
                break;
            case 'undo':
                say('undo');
                snd('undo');
                goStatus();
                break;
            case 'end':
                setStatus('go-status', goResult(e.result), 'over');
                say('end');
                snd('end', 170);
                break;
        }
    }

    function goNewGame() {
        go.newGame({
            size: parseInt($('go-size').value, 10),
            mode: $('go-mode').value,
            human: parseInt($('go-side').value, 10),
            level: parseInt($('go-level').value, 10)
        });
    }

    /* --------------------------------------------------------
       Xiangqi panel
       -------------------------------------------------------- */
    var xq = null;
    function xqStatus(extra) {
        var s = xq.getState();
        if (s.over) { setStatus('xq-status', xqResult(s.result), 'over'); return; }
        var mine = xq.getMode() === 'local' || s.turn === xq.getHuman();
        var msg = 'Move ' + (s.moveNo + 1) + ' - ' + xqSide(s.turn) + ' to play.';
        if (s.check) msg += ' Check! ' + zh('将军。');
        if (extra) msg += ' ' + extra;
        else if (!mine) msg += ' Tony is considering the position.';
        setStatus('xq-status', msg, (s.check || !mine) ? 'alert' : '');
    }

    var XQ_GLYPH = window.RuDaoXiangqi ? window.RuDaoXiangqi.Rules.GLYPH : null;

    function onXqEvent(e) {
        switch (e.kind) {
            case 'start':
                clearLog('xq-log');
                say('start');
                snd('start');
                xqStatus();
                break;
            case 'thinking':
                xqStatus();
                break;
            case 'move':
                var glyph = XQ_GLYPH ? zh(XQ_GLYPH[e.side][e.piece]) : '';
                addLog('xq-log', (e.by === 'ai' ? 'Tony' : 'You') + ' ' + xqSide(e.side) + ' ' + glyph +
                    ' ' + esc(e.coord) + (e.capture ? ' x' : ''), e.by === 'ai');
                say(e.capture ? 'capture' : (xq.getState().check ? 'check' : 'move'));
                snd(e.capture ? 'xq-capture' : 'xq');
                xqStatus();
                break;
            case 'check':
                say('check');
                if (!e.over) snd('check', 130);
                xqStatus();
                break;
            case 'select':
                snd('select');
                break;
            case 'invalid':
                setStatus('xq-status', esc(e.reason), 'alert');
                say('invalid');
                snd('invalid');
                break;
            case 'undo':
                say('undo');
                snd('undo');
                xqStatus();
                break;
            case 'end':
                setStatus('xq-status', xqResult(e.result), 'over');
                say('end');
                snd('end', 200);
                break;
        }
    }

    function xqNewGame() {
        xq.newGame({
            mode: $('xq-mode').value,
            human: $('xq-side').value,
            level: parseInt($('xq-level').value, 10)
        });
    }

    /* --------------------------------------------------------
       Tabs
       -------------------------------------------------------- */
    function switchTab(name) {
        var isGo = name === 'go';
        $('panel-go').hidden = !isGo;
        $('panel-xq').hidden = isGo;
        $('tab-go').classList.toggle('is-on', isGo);
        $('tab-xq').classList.toggle('is-on', !isGo);
        $('tab-go').setAttribute('aria-selected', isGo ? 'true' : 'false');
        $('tab-xq').setAttribute('aria-selected', isGo ? 'false' : 'true');
        if (isGo) goStatus(); else xqStatus();
    }

    /* --------------------------------------------------------
       Sound bar - on/off and volume, remembered in localStorage
       -------------------------------------------------------- */
    function wireSound() {
        var toggle = $('sound-toggle');
        var state = $('sound-state');
        var vol = $('sound-volume');
        if (!Sound || !toggle || !state || !vol) {
            if (toggle) toggle.disabled = true;
            return;
        }
        function paint() {
            var on = Sound.isEnabled();
            toggle.classList.toggle('is-on', on);
            toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
            state.textContent = on ? 'On' : 'Off';
            vol.disabled = !on;
            vol.value = String(Math.round(Sound.getVolume() * 100));
        }
        toggle.addEventListener('click', function () {
            var on = !Sound.isEnabled();
            Sound.setEnabled(on);
            paint();
            if (on) Sound.play('ui');
        });
        vol.addEventListener('input', function () {
            Sound.setVolume(parseInt(vol.value, 10) / 100);
        });
        vol.addEventListener('change', function () { Sound.play('ui'); });
        paint();
    }

    /* --------------------------------------------------------
       Boot
       -------------------------------------------------------- */
    function boot() {
        if (!window.RuDaoGo || !window.RuDaoXiangqi) {
            setStatus('go-status', 'The game scripts did not load. Please refresh the page.', 'alert');
            return;
        }
        XQ_GLYPH = window.RuDaoXiangqi.Rules.GLYPH;

        go = window.RuDaoGo.mount({
            root: $('go-board'), size: 9, mode: 'ai', human: 1, level: 2,
            onEvent: onGoEvent
        });
        xq = window.RuDaoXiangqi.mount({
            root: $('xq-board'), mode: 'ai', human: 'r', level: 2,
            onEvent: onXqEvent
        });

        $('tab-go').addEventListener('click', function () { switchTab('go'); });
        $('tab-xq').addEventListener('click', function () { switchTab('xq'); });

        $('go-new').addEventListener('click', goNewGame);
        $('go-undo').addEventListener('click', function () { go.undo(); });
        $('go-pass').addEventListener('click', function () { go.pass(); });
        $('go-resign').addEventListener('click', function () { go.resign(); });
        $('go-size').addEventListener('change', goNewGame);
        $('go-mode').addEventListener('change', goNewGame);
        $('go-side').addEventListener('change', goNewGame);
        $('go-level').addEventListener('change', goNewGame);

        $('xq-new').addEventListener('click', xqNewGame);
        $('xq-undo').addEventListener('click', function () { xq.undo(); });
        $('xq-resign').addEventListener('click', function () { xq.resign(); });
        $('xq-mode').addEventListener('change', xqNewGame);
        $('xq-side').addEventListener('change', xqNewGame);
        $('xq-level').addEventListener('change', xqNewGame);

        wireSound();

        var h = (window.location.hash || '').toLowerCase();
        if (/xiangqi|chinese-chess|panel-xq|chess/.test(h)) switchTab('xq');

        say('start');
        goStatus();
        xqStatus();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
