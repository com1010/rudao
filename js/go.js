/**
 * RuDao.org - WeiQi / Go (围棋) engine
 * ------------------------------------------------------------
 * Pure rules core (no DOM) + a small SVG board controller.
 * Rules: liberties, group capture, no-suicide, simple ko, two-pass
 * end, Chinese area scoring with 6.5 komi for White.
 *
 * The rules core is exported for Node-side unit tests:
 *   const Go = require('./go.js').Rules;
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.RuDaoGo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var EMPTY = 0, BLACK = 1, WHITE = 2;
    var KOMI = 6.5;

    function other(c) { return c === BLACK ? WHITE : BLACK; }
    function inB(size, x, y) { return x >= 0 && y >= 0 && x < size && y < size; }
    function idx(size, x, y) { return y * size + x; }

    function neighbors(size, x, y) {
        var r = [];
        if (x > 0) r.push([x - 1, y]);
        if (x < size - 1) r.push([x + 1, y]);
        if (y > 0) r.push([x, y - 1]);
        if (y < size - 1) r.push([x, y + 1]);
        return r;
    }

    /** Collect a stone group and its distinct liberty points. */
    function groupAt(board, size, x, y) {
        var color = board[idx(size, x, y)];
        if (!color) return null;
        var seen = Object.create(null), stack = [[x, y]], stones = [], libs = Object.create(null);
        seen[idx(size, x, y)] = 1;
        while (stack.length) {
            var p = stack.pop();
            stones.push(p);
            var ns = neighbors(size, p[0], p[1]);
            for (var i = 0; i < ns.length; i++) {
                var nx = ns[i][0], ny = ns[i][1], k = idx(size, nx, ny), v = board[k];
                if (v === EMPTY) {
                    if (!libs[k]) libs[k] = [nx, ny];
                } else if (v === color && !seen[k]) {
                    seen[k] = 1;
                    stack.push([nx, ny]);
                }
            }
        }
        return { color: color, stones: stones, libs: Object.keys(libs).map(function (k) { return libs[k]; }) };
    }

    /** Place a stone on a plain board array; return null for an illegal (suicide) move. */
    function place(board, size, x, y, color) {
        if (!inB(size, x, y) || board[idx(size, x, y)] !== EMPTY) return null;
        var b = board.slice(), opp = other(color), captured = [];
        b[idx(size, x, y)] = color;
        var ns = neighbors(size, x, y);
        for (var i = 0; i < ns.length; i++) {
            var nx = ns[i][0], ny = ns[i][1];
            if (b[idx(size, nx, ny)] !== opp) continue;
            var g = groupAt(b, size, nx, ny);
            if (g && g.libs.length === 0) {
                for (var j = 0; j < g.stones.length; j++) {
                    var s = g.stones[j], k = idx(size, s[0], s[1]);
                    if (b[k] === opp) { b[k] = EMPTY; captured.push(s); }
                }
            }
        }
        var own = groupAt(b, size, x, y);
        if (own.libs.length === 0) return null;
        return { board: b, captured: captured };
    }

    function hash(board) { return board.join(''); }

    function createState(size) {
        size = size || 9;
        return {
            size: size,
            board: new Array(size * size).fill(EMPTY),
            turn: BLACK,
            captures: { 1: 0, 2: 0 },
            passes: 0,
            last: null,
            ko: null,
            history: [],
            moveNo: 0,
            over: false,
            result: null
        };
    }

    function snapshot(s) {
        return {
            board: s.board.slice(), turn: s.turn,
            captures: { 1: s.captures[1], 2: s.captures[2] },
            passes: s.passes, last: s.last ? s.last.slice() : null,
            ko: s.ko, moveNo: s.moveNo, over: false, result: null
        };
    }

    function derive(s, snap) {
        var n = {
            size: s.size, board: s.board, turn: s.turn,
            captures: s.captures, passes: s.passes, last: s.last,
            ko: s.ko, moveNo: s.moveNo, over: s.over, result: s.result,
            history: s.history.concat([snap])
        };
        return n;
    }

    function tryMove(s, x, y) {
        if (s.over) return { ok: false, reason: 'The game has ended.' };
        if (!inB(s.size, x, y)) return { ok: false, reason: 'Outside the board.' };
        if (s.board[idx(s.size, x, y)] !== EMPTY) return { ok: false, reason: 'That point is occupied.' };
        var snap = snapshot(s);
        var res = place(s.board, s.size, x, y, s.turn);
        if (!res) return { ok: false, reason: 'Suicide is not allowed - a stone needs a liberty.' };
        var h = hash(res.board);
        if (s.ko !== null && h === s.ko) return { ok: false, reason: 'Ko - play elsewhere first, then come back.' };

        var n = derive(s, snap);
        n.board = res.board;
        n.captures = { 1: s.captures[1], 2: s.captures[2] };
        n.captures[s.turn] += res.captured.length;
        n.turn = other(s.turn);
        n.passes = 0;
        n.last = [x, y];
        n.ko = hash(s.board);
        n.moveNo = s.moveNo + 1;
        return { ok: true, state: n, captured: res.captured.length };
    }

    /** Flood-fill empty regions; a region surrounded by one colour is that colour's territory. */
    function score(s) {
        var size = s.size, b = s.board, seen = Object.create(null);
        var stones = { 1: 0, 2: 0 }, terr = { 1: 0, 2: 0 };
        for (var i = 0; i < b.length; i++) if (b[i]) stones[b[i]]++;
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var k = idx(size, x, y);
                if (b[k] !== EMPTY || seen[k]) continue;
                var stack = [[x, y]], region = 0, borders = Object.create(null);
                seen[k] = 1;
                while (stack.length) {
                    var p = stack.pop(); region++;
                    var ns = neighbors(size, p[0], p[1]);
                    for (var j = 0; j < ns.length; j++) {
                        var nx = ns[j][0], ny = ns[j][1], nk = idx(size, nx, ny), v = b[nk];
                        if (v === EMPTY) {
                            if (!seen[nk]) { seen[nk] = 1; stack.push([nx, ny]); }
                        } else borders[v] = 1;
                    }
                }
                var bk = borders[1] ? 1 : 0, wh = borders[2] ? 1 : 0;
                if (bk && !wh) terr[1] += region;
                else if (wh && !bk) terr[2] += region;
            }
        }
        var black = stones[1] + terr[1];
        var white = stones[2] + terr[2] + KOMI;
        return {
            black: black, white: white, komi: KOMI,
            stones: stones, territory: terr,
            winner: white > black ? WHITE : BLACK,
            margin: Math.abs(white - black)
        };
    }

    function doPass(s) {
        if (s.over) return { ok: false, reason: 'The game has ended.' };
        var snap = snapshot(s), n = derive(s, snap);
        n.turn = other(s.turn);
        n.passes = s.passes + 1;
        n.ko = null;
        n.last = null;
        n.moveNo = s.moveNo + 1;
        if (n.passes >= 2) {
            n.over = true;
            n.result = score(n);
        }
        return { ok: true, state: n, ended: n.over };
    }

    function undo(s, plies) {
        plies = plies || 1;
        var cur = s, removed = 0;
        while (plies-- > 0 && cur.history.length) {
            var h = cur.history, snap = h[h.length - 1];
            cur = {
                size: cur.size, board: snap.board, turn: snap.turn,
                captures: snap.captures, passes: snap.passes, last: snap.last,
                ko: snap.ko, moveNo: snap.moveNo, over: false, result: null,
                history: h.slice(0, -1)
            };
            removed++;
        }
        return { state: cur, removed: removed };
    }

    function legalMoves(s, color) {
        var out = [], colorToUse = color || s.turn, size = s.size;
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                if (s.board[idx(size, x, y)] !== EMPTY) continue;
                var res = place(s.board, size, x, y, colorToUse);
                if (!res) continue;
                if (colorToUse === s.turn && s.ko !== null && hash(res.board) === s.ko) continue;
                out.push([x, y]);
            }
        }
        return out;
    }

    function starPoints(size) {
        if (size === 19) return [3, 9, 15];
        if (size === 13) return [3, 6, 9];
        if (size === 9) return [2, 4, 6];
        var mid = Math.floor(size / 2);
        return [2, mid, size - 3];
    }

    /** A point fully ringed by friendly stones is an eye - a bot should not fill it. */
    function isOwnEye(board, size, x, y, color) {
        var ns = neighbors(size, x, y);
        for (var i = 0; i < ns.length; i++) {
            if (board[idx(size, ns[i][0], ns[i][1])] !== color) return false;
        }
        var diagonals = [[x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]];
        var enemies = 0, valid = 0;
        for (var j = 0; j < diagonals.length; j++) {
            var dx = diagonals[j][0], dy = diagonals[j][1];
            if (!inB(size, dx, dy)) continue;
            valid++;
            if (board[idx(size, dx, dy)] === other(color)) enemies++;
        }
        return enemies <= (valid <= 1 ? 0 : 1);
    }

    /**
     * Lightweight, entirely local opponent. It evaluates captures, atari,
     * self-atari, shape and opening points. It is a friendly table companion,
     * not a strong Go engine - the point is a pleasant game with the book.
     */
    function aiMove(s, color, level) {
        color = color || s.turn;
        var moves = legalMoves(s, color);
        if (!moves.length) return null;
        var size = s.size, stars = starPoints(size), starSet = Object.create(null);
        for (var a = 0; a < stars.length; a++) {
            for (var b = 0; b < stars.length; b++) starSet[idx(size, stars[a], stars[b])] = 1;
        }
        var center = (size - 1) / 2, best = null, bestScore = -Infinity;
        var jitter = level >= 3 ? 0.7 : (level === 2 ? 1.8 : 3.5);

        for (var m = 0; m < moves.length; m++) {
            var x = moves[m][0], y = moves[m][1];
            var res = place(s.board, size, x, y, color);
            if (!res) continue;
            var sc = 0;
            sc += res.captured.length * 22;
            if (!res.captured.length && isOwnEye(s.board, size, x, y, color)) sc -= 30;

            var own = groupAt(res.board, size, x, y);
            if (own.libs.length === 1 && !res.captured.length) sc -= 11;
            else if (own.libs.length === 2) sc -= 2;

            var ns = neighbors(size, x, y), opp = other(color);
            var touched = Object.create(null);
            for (var i = 0; i < ns.length; i++) {
                var nx = ns[i][0], ny = ns[i][1], v = s.board[idx(size, nx, ny)];
                if (v !== EMPTY) sc += 1.4;
                if (v === opp) {
                    var g = groupAt(s.board, size, nx, ny);
                    if (g && !touched[g.stones[0].join(',')]) {
                        touched[g.stones[0].join(',')] = 1;
                        if (g.libs.length === 2) sc += 7;      // put the opponent in atari
                        else if (g.libs.length === 1) sc += 12; // finish the capture
                    }
                    var g2 = groupAt(res.board, size, nx, ny);
                    if (g2 && g2.libs.length === 1) sc += 5;
                }
                if (v === color) {
                    var gf = groupAt(s.board, size, nx, ny);
                    if (gf && gf.libs.length === 1) {
                        var ga = groupAt(res.board, size, nx, ny);
                        if (ga && ga.libs.length > 1) sc += 9; // rescue a group in atari
                    }
                }
            }
            if (s.moveNo < size * 2) {
                if (starSet[idx(size, x, y)]) sc += 3;
                // favour 3-4 and 4-3 points in the opening
                var d = Math.min(Math.abs(x - 3), Math.abs(x - (size - 4))) +
                        Math.min(Math.abs(y - 3), Math.abs(y - (size - 4)));
                if (d === 0) sc += 2.5;
            }
            var dc = Math.abs(x - center) + Math.abs(y - center);
            sc += (1 - dc / (size - 1)) * 2.2;
            sc += Math.random() * jitter;
            if (sc > bestScore) { bestScore = sc; best = [x, y]; }
        }
        return best;
    }

    var Rules = {
        EMPTY: EMPTY, BLACK: BLACK, WHITE: WHITE, KOMI: KOMI,
        createState: createState, tryMove: tryMove, doPass: doPass, undo: undo,
        score: score, place: place, groupAt: groupAt, legalMoves: legalMoves,
        aiMove: aiMove, idx: idx, neighbors: neighbors, isOwnEye: isOwnEye,
        starPoints: starPoints
    };

    /* ---------------- SVG board controller (browser only) ---------------- */
    var CELL = 40, PAD = 26;

    function mount(opts) {
        if (typeof document === 'undefined') return null;
        var rootEl = opts.root;
        var state = createState(opts.size || 9);
        var mode = opts.mode || 'ai';           // 'ai' | 'local'
        var human = opts.human || BLACK;        // colour the visitor plays in ai mode
        var level = opts.level || 2;
        var onEvent = opts.onEvent || function () {};
        var busy = false, hover = null;

        function dims() { var W = (state.size - 1) * CELL + 2 * PAD; return { W: W, H: W }; }

        function svgMarkup() {
            var N = state.size, d = dims(), W = d.W, out = [];
            out.push('<svg class="go-svg" viewBox="0 0 ' + W + ' ' + W + '" xmlns="http://www.w3.org/2000/svg" aria-label="WeiQi Go board, ' + N + ' by ' + N + '" role="img">');
            out.push('<defs>' +
                '<radialGradient id="goBlack" cx="34%" cy="28%" r="72%"><stop offset="0" stop-color="#6a6a6a"/><stop offset="45%" stop-color="#262626"/><stop offset="100%" stop-color="#060606"/></radialGradient>' +
                '<radialGradient id="goWhite" cx="34%" cy="28%" r="74%"><stop offset="0" stop-color="#ffffff"/><stop offset="62%" stop-color="#f3f0e8"/><stop offset="100%" stop-color="#c6c0b0"/></radialGradient>' +
                '</defs>');
            var last = PAD + (N - 1) * CELL;
            for (var i = 0; i < N; i++) {
                var p = PAD + i * CELL;
                out.push('<line x1="' + p + '" y1="' + PAD + '" x2="' + p + '" y2="' + last + '" stroke="#63482a" stroke-width="1.15"/>');
                out.push('<line x1="' + PAD + '" y1="' + p + '" x2="' + last + '" y2="' + p + '" stroke="#63482a" stroke-width="1.15"/>');
            }
            var stars = starPoints(N), sr = N >= 13 ? 3.2 : 3.6;
            for (var a = 0; a < stars.length; a++) {
                for (var b = 0; b < stars.length; b++) {
                    out.push('<circle cx="' + (PAD + stars[a] * CELL) + '" cy="' + (PAD + stars[b] * CELL) + '" r="' + sr + '" fill="#5a3f22"/>');
                }
            }
            var letters = 'ABCDEFGHJKLMNOPQRST';
            for (var c = 0; c < N; c++) {
                out.push('<text x="' + (PAD + c * CELL) + '" y="' + (PAD - 9) + '" text-anchor="middle" font-size="9" fill="#7a5c35" font-family="Georgia, serif">' + letters.charAt(c) + '</text>');
                out.push('<text x="' + (PAD - 12) + '" y="' + (PAD + c * CELL + 3.2) + '" text-anchor="middle" font-size="9" fill="#7a5c35" font-family="Georgia, serif">' + (N - c) + '</text>');
            }
            for (var y = 0; y < N; y++) {
                for (var x = 0; x < N; x++) {
                    var v = state.board[idx(N, x, y)];
                    if (!v) continue;
                    var cx = PAD + x * CELL, cy = PAD + y * CELL, r = CELL * 0.465;
                    out.push('<ellipse cx="' + (cx + 1.4) + '" cy="' + (cy + 2.2) + '" rx="' + r + '" ry="' + (r * 0.94) + '" fill="rgba(50,30,10,.22)"/>');
                    out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="url(#' + (v === BLACK ? 'goBlack' : 'goWhite') + ')" stroke="' + (v === BLACK ? '#111' : '#b9b2a2') + '" stroke-width=".7"/>');
                    if (state.last && state.last[0] === x && state.last[1] === y) {
                        out.push('<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="none" stroke="' + (v === BLACK ? '#d9b45a' : '#a93226') + '" stroke-width="1.8"/>');
                    }
                }
            }
            out.push('<circle id="goGhost" cx="0" cy="0" r="' + (CELL * 0.465) + '" opacity="0" pointer-events="none" fill="' + (state.turn === BLACK ? '#111' : '#fff') + '"/>');
            out.push('</svg>');
            return out.join('');
        }

        function render() {
            rootEl.innerHTML = svgMarkup();
            var svg = rootEl.querySelector('svg');
            svg.addEventListener('click', onClick);
            svg.addEventListener('mousemove', onHover);
            svg.addEventListener('mouseleave', function () {
                var g = rootEl.querySelector('#goGhost');
                if (g) g.setAttribute('opacity', '0');
                hover = null;
            });
            if (hover) paintGhost();
        }

        function toPoint(evt) {
            var svg = rootEl.querySelector('svg');
            if (!svg) return null;
            var rect = svg.getBoundingClientRect(), d = dims();
            var sx = (evt.clientX - rect.left) / rect.width * d.W;
            var sy = (evt.clientY - rect.top) / rect.height * d.H;
            var x = Math.round((sx - PAD) / CELL), y = Math.round((sy - PAD) / CELL);
            if (!inB(state.size, x, y)) return null;
            if (Math.abs(sx - (PAD + x * CELL)) > CELL * 0.48) return null;
            if (Math.abs(sy - (PAD + y * CELL)) > CELL * 0.48) return null;
            return [x, y];
        }

        function paintGhost() {
            var g = rootEl.querySelector('#goGhost');
            if (!g || !hover) return;
            var N = state.size, x = hover[0], y = hover[1];
            var free = state.board[idx(N, x, y)] === EMPTY && !state.over && !busy;
            var mine = mode === 'local' || state.turn === human;
            g.setAttribute('cx', PAD + x * CELL);
            g.setAttribute('cy', PAD + y * CELL);
            g.setAttribute('fill', state.turn === BLACK ? '#111' : '#fff');
            g.setAttribute('opacity', free && mine ? '0.42' : '0');
        }

        function onHover(evt) {
            hover = toPoint(evt);
            paintGhost();
        }

        function emit(kind, extra) {
            var e = { kind: kind, game: 'go', turn: state.turn, over: state.over,
                      captures: { black: state.captures[1], white: state.captures[2] },
                      moveNo: state.moveNo, result: state.result,
                      mode: mode, human: human };
            if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) e[k] = extra[k];
            onEvent(e);
        }

        function aiTurn() {
            if (state.over || mode !== 'ai' || state.turn === human) return;
            busy = true;
            emit('thinking', { by: 'ai' });
            window.setTimeout(function () {
                if (state.over) { busy = false; return; }
                var mv = aiMove(state, state.turn, level);
                if (mv) {
                    var r = tryMove(state, mv[0], mv[1]);
                    if (r.ok) {
                        state = r.state;
                        render();
                        emit('move', { by: 'ai', captured: r.captured, x: mv[0], y: mv[1] });
                    }
                } else {
                    var p = doPass(state);
                    if (p.ok) {
                        state = p.state;
                        render();
                        emit('pass', { by: 'ai', ended: p.ended });
                    }
                }
                busy = false;
                if (state.over) emit('end', { result: state.result });
            }, 320);
        }

        function onClick(evt) {
            if (busy || state.over) return;
            if (mode === 'ai' && state.turn !== human) return;
            var p = toPoint(evt);
            if (!p) return;
            var r = tryMove(state, p[0], p[1]);
            if (!r.ok) { emit('invalid', { reason: r.reason }); return; }
            state = r.state;
            render();
            emit('move', { by: 'human', captured: r.captured, x: p[0], y: p[1] });
            aiTurn();
        }

        function api() {
            return {
                newGame: function (o) {
                    o = o || {};
                    state = createState(o.size || state.size);
                    mode = o.mode || mode;
                    human = o.human || human;
                    level = o.level || level;
                    busy = false; hover = null;
                    render();
                    emit('start', { size: state.size });
                    aiTurn();
                },
                pass: function () {
                    if (busy || state.over) return;
                    if (mode === 'ai' && state.turn !== human) return;
                    var r = doPass(state);
                    if (!r.ok) { emit('invalid', { reason: r.reason }); return; }
                    state = r.state;
                    render();
                    emit('pass', { by: 'human', ended: r.ended });
                    if (state.over) { emit('end', { result: state.result }); return; }
                    aiTurn();
                },
                undo: function () {
                    if (busy) return;
                    var plies = mode === 'ai' ? 2 : 1;
                    var u = undo(state, plies);
                    state = u.state;
                    render();
                    emit('undo', { removed: u.removed });
                },
                resign: function () {
                    if (state.over) return;
                    state = Object.assign({}, state, {
                        over: true,
                        result: { resigned: true, winner: mode === 'ai' ? other(human) : other(state.turn) }
                    });
                    render();
                    emit('end', { result: state.result });
                },
                getState: function () { return state; },
                getMode: function () { return mode; },
                getHuman: function () { return human; }
            };
        }

        render();
        return api();
    }

    return { Rules: Rules, mount: mount };
});
