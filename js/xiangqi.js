/**
 * RuDao.org - Chinese Chess / Xiangqi (象棋) engine
 * ------------------------------------------------------------
 * Pure rules core (no DOM) + a small SVG board controller.
 * Full piece movement, palace, river, horse-leg, elephant-eye,
 * cannon screen, flying general, check and checkmate.
 *
 * The rules core is exported for Node-side unit tests:
 *   const XQ = require('./xiangqi.js').Rules;
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.RuDaoXiangqi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var W = 9, H = 10, RED = 'r', BLACK = 'b';
    var GLYPH = {
        r: { K: '帥', A: '仕', E: '相', R: '俥', H: '傌', C: '炮', P: '兵' },
        b: { K: '將', A: '士', E: '象', R: '車', H: '馬', C: '砲', P: '卒' }
    };
    var NAME = { K: 'General', A: 'Advisor', E: 'Elephant', R: 'Chariot', H: 'Horse', C: 'Cannon', P: 'Soldier' };
    var VALUE = { K: 10000, R: 900, C: 460, H: 420, E: 200, A: 200, P: 100 };

    function other(c) { return c === RED ? BLACK : RED; }
    function at(board, x, y) { return board[y * W + x]; }
    function inB(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
    function clone(board) { return board.slice(); }
    function apply(board, from, to) {
        var b = clone(board);
        b[to[1] * W + to[0]] = b[from[1] * W + from[0]];
        b[from[1] * W + from[0]] = null;
        return b;
    }
    function inPalace(c, x, y) {
        if (x < 3 || x > 5) return false;
        return c === RED ? (y >= 7 && y <= 9) : (y >= 0 && y <= 2);
    }
    function crossedRiver(c, y) { return c === RED ? y <= 4 : y >= 5; }
    function forward(c) { return c === RED ? -1 : 1; }

    function initialBoard() {
        var b = new Array(W * H).fill(null);
        var back = ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R'];
        for (var x = 0; x < W; x++) {
            b[0 * W + x] = { c: BLACK, t: back[x] };
            b[9 * W + x] = { c: RED, t: back[x] };
        }
        b[2 * W + 1] = { c: BLACK, t: 'C' };
        b[2 * W + 7] = { c: BLACK, t: 'C' };
        b[7 * W + 1] = { c: RED, t: 'C' };
        b[7 * W + 7] = { c: RED, t: 'C' };
        var pawns = [0, 2, 4, 6, 8];
        for (var i = 0; i < pawns.length; i++) {
            b[3 * W + pawns[i]] = { c: BLACK, t: 'P' };
            b[6 * W + pawns[i]] = { c: RED, t: 'P' };
        }
        return b;
    }

    /** Pseudo-legal destination points for one piece (own-piece squares excluded). */
    function pseudo(board, x, y) {
        var p = at(board, x, y);
        if (!p) return [];
        var out = [], c = p.c, t = p.t, i, d, nx, ny, q;
        var orth = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        var diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

        function push(tx, ty) {
            if (!inB(tx, ty)) return;
            var v = at(board, tx, ty);
            if (!v || v.c !== c) out.push([tx, ty]);
        }

        if (t === 'R' || t === 'C') {
            for (i = 0; i < orth.length; i++) {
                d = orth[i];
                nx = x + d[0]; ny = y + d[1];
                var screen = false;
                while (inB(nx, ny)) {
                    q = at(board, nx, ny);
                    if (!q) {
                        if (t === 'R' || !screen) out.push([nx, ny]);
                    } else {
                        if (t === 'R') { push(nx, ny); break; }
                        if (!screen) { screen = true; }
                        else { if (q.c !== c) out.push([nx, ny]); break; }
                    }
                    nx += d[0]; ny += d[1];
                }
            }
        } else if (t === 'H') {
            var jumps = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
            for (i = 0; i < jumps.length; i++) {
                var dx = jumps[i][0], dy = jumps[i][1];
                var lx = x + (Math.abs(dx) === 2 ? (dx > 0 ? 1 : -1) : 0);
                var ly = y + (Math.abs(dy) === 2 ? (dy > 0 ? 1 : -1) : 0);
                if (!inB(lx, ly) || at(board, lx, ly)) continue; // blocked horse leg
                push(x + dx, y + dy);
            }
        } else if (t === 'E') {
            for (i = 0; i < diag.length; i++) {
                var ex = x + diag[i][0] * 2, ey = y + diag[i][1] * 2;
                if (!inB(ex, ey)) continue;
                if (c === RED ? ey < 5 : ey > 4) continue;      // never cross the river
                if (at(board, x + diag[i][0], y + diag[i][1])) continue; // blocked elephant eye
                push(ex, ey);
            }
        } else if (t === 'A') {
            for (i = 0; i < diag.length; i++) {
                var ax = x + diag[i][0], ay = y + diag[i][1];
                if (!inPalace(c, ax, ay)) continue;
                push(ax, ay);
            }
        } else if (t === 'K') {
            for (i = 0; i < orth.length; i++) {
                var tx = x + orth[i][0], ty = y + orth[i][1];
                if (!inPalace(c, tx, ty)) continue;
                push(tx, ty);
            }
            // Flying general: facing generals with a clear file is an immediate capture.
            var f = forward(c), yy = y + f;
            while (inB(x, yy)) {
                var v = at(board, x, yy);
                if (v) { if (v.c !== c && v.t === 'K') out.push([x, yy]); break; }
                yy += f;
            }
        } else if (t === 'P') {
            push(x, y + forward(c));
            if (crossedRiver(c, y)) { push(x - 1, y); push(x + 1, y); }
        }
        return out;
    }

    function findKing(board, c) {
        for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
                var p = at(board, x, y);
                if (p && p.c === c && p.t === 'K') return [x, y];
            }
        }
        return null;
    }

    function inCheck(board, c) {
        var k = findKing(board, c);
        if (!k) return true;
        var opp = other(c);
        for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
                var p = at(board, x, y);
                if (!p || p.c !== opp) continue;
                var ms = pseudo(board, x, y);
                for (var i = 0; i < ms.length; i++) {
                    if (ms[i][0] === k[0] && ms[i][1] === k[1]) return true;
                }
            }
        }
        return false;
    }

    /** All fully legal moves for one side, each tagged with its captured piece. */
    function legalMoves(board, c) {
        var out = [];
        for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
                var p = at(board, x, y);
                if (!p || p.c !== c) continue;
                var ms = pseudo(board, x, y);
                for (var i = 0; i < ms.length; i++) {
                    var tx = ms[i][0], ty = ms[i][1];
                    var nb = apply(board, [x, y], [tx, ty]);
                    if (inCheck(nb, c)) continue;
                    out.push({
                        from: [x, y], to: [tx, ty],
                        piece: p.t, side: c,
                        capture: at(board, tx, ty) || null
                    });
                }
            }
        }
        return out;
    }

    function evaluate(board, c) {
        var s = 0;
        for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
                var p = at(board, x, y);
                if (!p) continue;
                var v = VALUE[p.t];
                if (p.t === 'P' && crossedRiver(p.c, y)) v += 40;
                if (p.t === 'R' || p.t === 'C') v += (4 - Math.abs(x - 4)) * 3;
                if (p.t === 'H' || p.t === 'P') v += (4 - Math.abs(x - 4)) * 2;
                s += (p.c === RED ? v : -v);
            }
        }
        return c === RED ? s : -s;
    }

    function search(board, c, depth, alpha, beta, ctx) {
        ctx.nodes++;
        if (depth <= 0 || ctx.nodes > ctx.limit || (ctx.nodes & 255) === 0 && Date.now() > ctx.deadline) {
            return evaluate(board, c);
        }
        var moves = legalMoves(board, c);
        if (!moves.length) return -90000 + (ctx.rootDepth - depth);
        moves.sort(function (a, b) {
            return (b.capture ? VALUE[b.capture.t] : 0) - (a.capture ? VALUE[a.capture.t] : 0);
        });
        var best = -Infinity;
        for (var i = 0; i < moves.length; i++) {
            var m = moves[i];
            var nb = apply(board, m.from, m.to);
            var v = -search(nb, other(c), depth - 1, -beta, -alpha, ctx);
            if (v > best) best = v;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
            if (ctx.nodes > ctx.limit) break;
        }
        return best;
    }

    /** Local alpha-beta opponent. Level 1/2/3 = 1/2/3 ply. */
    function aiMove(board, c, level) {
        level = level || 2;
        var moves = legalMoves(board, c);
        if (!moves.length) return null;
        var depth = level === 1 ? 1 : (level === 2 ? 2 : 3);
        var ctx = {
            nodes: 0,
            limit: level >= 3 ? 18000 : 14000,
            deadline: Date.now() + (level >= 3 ? 2200 : 900),
            rootDepth: depth
        };
        var jitter = level === 1 ? 70 : (level === 2 ? 16 : 4);
        moves = moves.map(function (m) {
            return { m: m, rank: (m.capture ? VALUE[m.capture.t] : 0) + Math.random() * (jitter * 3) };
        }).sort(function (a, b) { return b.rank - a.rank; }).map(function (o) { return o.m; });

        var best = moves[0], bestScore = -Infinity;
        for (var i = 0; i < moves.length; i++) {
            var m = moves[i];
            var nb = apply(board, m.from, m.to);
            var v = -search(nb, other(c), depth - 1, -Infinity, Infinity, ctx);
            v += Math.random() * jitter;
            if (v > bestScore) { bestScore = v; best = m; }
            if (ctx.nodes > ctx.limit || Date.now() > ctx.deadline) break;
        }
        return best;
    }

    function createState() {
        return {
            board: initialBoard(), turn: RED, history: [], moveNo: 0,
            last: null, check: false, over: false, result: null
        };
    }

    function snapshot(s) {
        return {
            board: clone(s.board), turn: s.turn, moveNo: s.moveNo,
            last: s.last ? [s.last[0].slice(), s.last[1].slice()] : null,
            check: s.check
        };
    }

    function tryMove(s, from, to) {
        if (s.over) return { ok: false, reason: 'The game has ended.' };
        var p = at(s.board, from[0], from[1]);
        if (!p || p.c !== s.turn) return { ok: false, reason: 'Choose one of your own pieces.' };
        var ms = pseudo(s.board, from[0], from[1]), valid = false;
        for (var i = 0; i < ms.length; i++) {
            if (ms[i][0] === to[0] && ms[i][1] === to[1]) { valid = true; break; }
        }
        if (!valid) return { ok: false, reason: NAME[p.t] + ' cannot move there.' };
        var nb = apply(s.board, from, to);
        if (inCheck(nb, s.turn)) return { ok: false, reason: 'That would leave your general in check.' };

        var snap = snapshot(s), opp = other(s.turn);
        var n = {
            board: nb, turn: opp, moveNo: s.moveNo + 1,
            last: [from.slice(), to.slice()],
            check: inCheck(nb, opp), over: false, result: null,
            history: s.history.concat([snap])
        };
        var replies = legalMoves(nb, opp);
        if (!replies.length) {
            n.over = true;
            n.result = { winner: s.turn, reason: n.check ? 'checkmate' : 'stalemate' };
        }
        return { ok: true, state: n, capture: at(s.board, to[0], to[1]), piece: p.t, side: p.c };
    }

    function undo(s, plies) {
        plies = plies || 1;
        var cur = s, removed = 0;
        while (plies-- > 0 && cur.history.length) {
            var h = cur.history, snap = h[h.length - 1];
            cur = {
                board: snap.board, turn: snap.turn, moveNo: snap.moveNo,
                last: snap.last, check: snap.check, over: false, result: null,
                history: h.slice(0, -1)
            };
            removed++;
        }
        return { state: cur, removed: removed };
    }

    var Rules = {
        W: W, H: H, RED: RED, BLACK: BLACK, GLYPH: GLYPH, NAME: NAME, VALUE: VALUE,
        initialBoard: initialBoard, pseudo: pseudo, legalMoves: legalMoves,
        inCheck: inCheck, apply: apply, at: at, aiMove: aiMove,
        createState: createState, tryMove: tryMove, undo: undo, evaluate: evaluate,
        findKing: findKing
    };

    /* ---------------- SVG board controller (browser only) ---------------- */
    var CELL = 58, PAD = 34, VW = 8 * CELL + 2 * PAD, VH = 9 * CELL + 2 * PAD;

    function mount(opts) {
        if (typeof document === 'undefined') return null;
        var rootEl = opts.root;
        var state = createState();
        var mode = opts.mode || 'ai';
        var human = opts.human || RED;
        var level = opts.level || 2;
        var onEvent = opts.onEvent || function () {};
        var selected = null, busy = false;

        function px(x) { return PAD + x * CELL; }
        function py(y) { return PAD + y * CELL; }

        function boardFrame() {
            var o = [];
            var i, x0 = PAD, x1 = PAD + 8 * CELL, y0 = PAD, y1 = PAD + 9 * CELL;
            o.push('<svg class="xq-svg" viewBox="0 0 ' + VW + ' ' + VH + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Chinese chess board">');
            o.push('<defs>' +
                '<radialGradient id="xqDisc" cx="36%" cy="28%" r="76%"><stop offset="0" stop-color="#fffaf0"/><stop offset="70%" stop-color="#f0e3c8"/><stop offset="100%" stop-color="#d9c49b"/></radialGradient>' +
                '</defs>');
            for (i = 0; i < H; i++) {
                o.push('<line x1="' + x0 + '" y1="' + py(i) + '" x2="' + x1 + '" y2="' + py(i) + '" stroke="#6b4d2a" stroke-width="1.25"/>');
            }
            for (i = 0; i < W; i++) {
                if (i === 0 || i === W - 1) {
                    o.push('<line x1="' + px(i) + '" y1="' + y0 + '" x2="' + px(i) + '" y2="' + y1 + '" stroke="#6b4d2a" stroke-width="1.25"/>');
                } else {
                    o.push('<line x1="' + px(i) + '" y1="' + y0 + '" x2="' + px(i) + '" y2="' + py(4) + '" stroke="#6b4d2a" stroke-width="1.25"/>');
                    o.push('<line x1="' + px(i) + '" y1="' + py(5) + '" x2="' + px(i) + '" y2="' + y1 + '" stroke="#6b4d2a" stroke-width="1.25"/>');
                }
            }
            // palaces
            [[3, 0, 5, 2], [5, 0, 3, 2], [3, 7, 5, 9], [5, 7, 3, 9]].forEach(function (d) {
                o.push('<line x1="' + px(d[0]) + '" y1="' + py(d[1]) + '" x2="' + px(d[2]) + '" y2="' + py(d[3]) + '" stroke="#6b4d2a" stroke-width="1.25"/>');
            });
            // river
            var riverY = PAD + 4.62 * CELL;
            o.push('<text x="' + (PAD + 1.75 * CELL) + '" y="' + riverY + '" text-anchor="middle" font-size="25" letter-spacing="8" fill="#8a6535" font-family="SimSun, Songti SC, serif">楚河</text>');
            o.push('<text x="' + (PAD + 6.25 * CELL) + '" y="' + riverY + '" text-anchor="middle" font-size="25" letter-spacing="8" fill="#8a6535" font-family="SimSun, Songti SC, serif">漢界</text>');
            o.push('</svg>');
            return o.join('');
        }

        function hints() {
            if (!selected) return [];
            var p = at(state.board, selected[0], selected[1]);
            if (!p || p.c !== state.turn || state.over) return [];
            var out = [], ms = legalMoves(state.board, state.turn);
            for (var i = 0; i < ms.length; i++) {
                if (ms[i].from[0] === selected[0] && ms[i].from[1] === selected[1]) out.push(ms[i]);
            }
            return out;
        }

        function render() {
            var o = [boardFrame()], i, y, x, p;
            var svg = o[0].replace('</svg>', '');
            o[0] = svg;
            var hs = hints();
            for (i = 0; i < hs.length; i++) {
                var t = hs[i].to;
                if (hs[i].capture) {
                    o.push('<circle cx="' + px(t[0]) + '" cy="' + py(t[1]) + '" r="' + (CELL * 0.44) + '" fill="none" stroke="#a93226" stroke-width="2.4" opacity=".72"/>');
                } else {
                    o.push('<circle cx="' + px(t[0]) + '" cy="' + py(t[1]) + '" r="6" fill="#a93226" opacity=".55"/>');
                }
            }
            if (selected) {
                o.push('<circle cx="' + px(selected[0]) + '" cy="' + py(selected[1]) + '" r="' + (CELL * 0.48) + '" fill="none" stroke="#b8923a" stroke-width="2.6"/>');
            }
            if (state.last) {
                [[state.last[0], 'last-from'], [state.last[1], 'last-to']].forEach(function (d) {
                    o.push('<circle cx="' + px(d[0][0]) + '" cy="' + py(d[0][1]) + '" r="' + (CELL * 0.46) + '" fill="none" stroke="' + (d[1] === 'last-to' ? '#2f7d5b' : '#9a8a68') + '" stroke-width="1.7" stroke-dasharray="4 3" opacity=".85"/>');
                });
            }
            for (y = 0; y < H; y++) {
                for (x = 0; x < W; x++) {
                    p = at(state.board, x, y);
                    if (!p) continue;
                    var cx = px(x), cy = py(y), r = CELL * 0.415;
                    var col = p.c === RED ? '#a93226' : '#26251f';
                    o.push('<ellipse cx="' + (cx + 1.6) + '" cy="' + (cy + 3) + '" rx="' + r + '" ry="' + (r * 0.95) + '" fill="rgba(60,38,12,.22)"/>');
                    o.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="url(#xqDisc)" stroke="' + col + '" stroke-width="2.1"/>');
                    o.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (r - 4.2) + '" fill="none" stroke="' + col + '" stroke-width=".7" opacity=".55"/>');
                    o.push('<text x="' + cx + '" y="' + (cy + 9.5) + '" text-anchor="middle" font-size="27" font-weight="400" fill="' + col + '" font-family="SimSun, Songti SC, Noto Serif CJK SC, serif">' + GLYPH[p.c][p.t] + '</text>');
                    if (p.t === 'K' && state.check && p.c === state.turn) {
                        o.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (r + 5) + '" fill="none" stroke="#d33b2c" stroke-width="2.4" opacity=".9"/>');
                    }
                }
            }
            o.push('</svg>');

            // keep the static frame inside one SVG: everything above was appended
            // to the same string, so join directly
            rootEl.innerHTML = o.join('');
            var el = rootEl.querySelector('svg');
            el.addEventListener('click', onClick);
        }

        function toPoint(evt) {
            var svg = rootEl.querySelector('svg');
            if (!svg) return null;
            var rect = svg.getBoundingClientRect();
            var sx = (evt.clientX - rect.left) / rect.width * VW;
            var sy = (evt.clientY - rect.top) / rect.height * VH;
            var x = Math.round((sx - PAD) / CELL), y = Math.round((sy - PAD) / CELL);
            if (!inB(x, y)) return null;
            if (Math.abs(sx - px(x)) > CELL * 0.47 || Math.abs(sy - py(y)) > CELL * 0.47) return null;
            return [x, y];
        }

        function emit(kind, extra) {
            var e = {
                kind: kind, game: 'xiangqi', turn: state.turn, over: state.over,
                check: state.check, moveNo: state.moveNo, result: state.result,
                mode: mode, human: human
            };
            if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) e[k] = extra[k];
            onEvent(e);
        }

        function coord(pt) { return String.fromCharCode(65 + pt[0]) + (10 - pt[1]); }

        function aiTurn() {
            if (state.over || mode !== 'ai' || state.turn === human) return;
            busy = true;
            emit('thinking', { by: 'ai' });
            window.setTimeout(function () {
                if (state.over) { busy = false; return; }
                var mv = aiMove(state.board, state.turn, level);
                busy = false;
                if (!mv) { emit('end', { result: { winner: human, reason: 'no legal move' } }); return; }
                var r = tryMove(state, mv.from, mv.to);
                if (!r.ok) return;
                state = r.state;
                selected = null;
                render();
                emit('move', {
                    by: 'ai', capture: r.capture, piece: r.piece, side: r.side,
                    from: mv.from, to: mv.to, coord: coord(mv.from) + '-' + coord(mv.to)
                });
                if (state.over) emit('end', { result: state.result });
                else if (state.check) emit('check', { side: state.turn });
            }, 360);
        }

        function doMove(from, to) {
            var r = tryMove(state, from, to);
            if (!r.ok) { emit('invalid', { reason: r.reason }); return; }
            state = r.state;
            selected = null;
            render();
            emit('move', {
                by: 'human', capture: r.capture, piece: r.piece, side: r.side,
                from: from, to: to, coord: coord(from) + '-' + coord(to)
            });
            if (state.over) { emit('end', { result: state.result }); return; }
            if (state.check) emit('check', { side: state.turn });
            aiTurn();
        }

        function onClick(evt) {
            if (busy || state.over) return;
            if (mode === 'ai' && state.turn !== human) return;
            var pt = toPoint(evt);
            if (!pt) return;
            var p = at(state.board, pt[0], pt[1]);
            if (selected) {
                if (p && p.c === state.turn) {
                    selected = pt; render();
                    emit('select', { by: 'human', piece: p.t, side: state.turn, from: pt });
                    return;
                }
                var hs = hints(), found = false;
                for (var i = 0; i < hs.length; i++) {
                    if (hs[i].to[0] === pt[0] && hs[i].to[1] === pt[1]) { found = true; break; }
                }
                if (found) { doMove(selected, pt); return; }
                selected = null; render(); return;
            }
            if (p && p.c === state.turn) {
                selected = pt; render();
                emit('select', { by: 'human', piece: p.t, side: state.turn, from: pt });
            }
        }

        function api() {
            return {
                newGame: function (o) {
                    o = o || {};
                    state = createState();
                    mode = o.mode || mode;
                    human = o.human || human;
                    level = o.level || level;
                    selected = null; busy = false;
                    render();
                    emit('start', { side: human });
                    aiTurn();
                },
                undo: function () {
                    if (busy) return;
                    var plies = mode === 'ai' ? 2 : 1;
                    var u = undo(state, plies);
                    state = u.state;
                    selected = null;
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
