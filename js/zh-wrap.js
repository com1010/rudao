/**
 * RuDao.org - CJK typography rule (shared)
 * ------------------------------------------------------------
 * User rule 2026-11-06: this is mostly an English book. ALL Chinese
 * text - AND the punctuation immediately before and after the Chinese -
 * renders exactly 3pt (4px) SMALLER than the adjacent English, at normal
 * weight, everywhere on the site. CSS does the sizing via .zh (see
 * css/styles.css); this script wraps every CJK run in <span class="zh">.
 *
 * Two deliberate exclusions that the inline copy in index.html does not
 * need:
 *   1. anything inside an <svg> (board coordinate labels and the river
 *      text 楚河漢界 are game symbols, not prose)
 *   2. anything inside [data-no-zh] (the playable boards)
 * Board piece glyphs keep their designed size; all other Chinese on the
 * page follows the 3pt-smaller, never-bold rule.
 *
 * Re-runnable: window.ruDaoZh(root) wraps a subtree after dynamic updates.
 */
(function () {
    'use strict';

    var CJK = '[\\u2E80-\\u2EFF\\u3040-\\u30FF\\u3130-\\u318F\\u31C0-\\u31EF\\u3200-\\u32FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]';
    var PUNC = '[\\u2013-\\u201D\\u3000-\\u303F\\uFE30-\\uFE4F\\uFF01-\\uFF60!-/:-@\\[-`\\{-~]';
    var RE = new RegExp('(?:' + PUNC + '*' + CJK + '+)+' + PUNC + '*', 'g');
    var SKIP = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, NOSCRIPT: 1 };

    function wrapText(node) {
        var text = node.nodeValue;
        RE.lastIndex = 0;
        if (!text || !RE.test(text)) return;
        RE.lastIndex = 0;
        var frag = document.createDocumentFragment(), last = 0, m;
        while ((m = RE.exec(text))) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            var span = document.createElement('span');
            span.className = 'zh';
            span.textContent = m[0];
            frag.appendChild(span);
            last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
    }

    function wrap(root) {
        root = root || document.body;
        if (!root) return;
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                var p = n.parentNode;
                if (!p || SKIP[p.nodeName]) return NodeFilter.FILTER_REJECT;
                if (p.closest && (p.closest('.zh') || p.closest('[data-no-zh]') || p.closest('svg'))) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (var i = 0; i < nodes.length; i++) wrapText(nodes[i]);
    }

    /* External links whose visible text is itself a URL render at 6pt. */
    var URLTEXT = /(https?:\/\/|www\.)|[\w-]+\.(com|org|net|cc|io|ai|cn|hk|edu|gov|co|me|tv)(\b|\/)/i;
    function markUrlLinks() {
        var as = document.querySelectorAll('a[href^="http"]');
        for (var i = 0; i < as.length; i++) {
            var t = (as[i].textContent || '').trim();
            if (t && URLTEXT.test(t)) as[i].classList.add('urllink');
        }
    }

    window.ruDaoZh = wrap;

    function run() { wrap(document.body); markUrlLinks(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
})();
