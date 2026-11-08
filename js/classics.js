/**
 * RuDao.org - Chinese classics reader
 * ------------------------------------------------------------
 * Switches the full text between simplified and original (traditional)
 * characters. Both complete texts are already present in the static HTML;
 * this only decides which one is visible. No network, no fonts to fetch,
 * no text is translated or generated at runtime.
 *
 * Preference is stored per browser and shared by all three classic pages.
 */
(function () {
    'use strict';

    var KEY = 'rudao.classics.variant';
    var buttons = document.querySelectorAll('.cl-switch-btn');
    if (!buttons.length) return;

    function read() {
        try {
            var v = localStorage.getItem(KEY);
            return (v === 't' || v === 's') ? v : 's';
        } catch (e) { return 's'; }
    }
    function store(v) {
        try { localStorage.setItem(KEY, v); } catch (e) { /* private mode */ }
    }

    function apply(v) {
        var blocks = document.querySelectorAll('.cl-v');
        for (var i = 0; i < blocks.length; i++) {
            blocks[i].classList.toggle('is-active', blocks[i].getAttribute('data-variant') === v);
        }

        /* Chapter headings and the contents list follow the same variant.
           The Chinese sits inside .zh so the 3pt-smaller rule survives. */
        var chapters = document.querySelectorAll('.cl-chapter');
        var tocCn = document.querySelectorAll('.cl-toc-cn .zh');
        for (var j = 0; j < chapters.length; j++) {
            var active = chapters[j].querySelector('.cl-v[data-variant="' + v + '"]');
            if (!active) continue;
            var title = active.getAttribute('data-title') || '';
            var head = chapters[j].querySelector('.cl-ch-cn .zh') || chapters[j].querySelector('.cl-ch-cn');
            if (head) head.textContent = title;
            if (tocCn[j]) tocCn[j].textContent = title;
        }

        for (var k = 0; k < buttons.length; k++) {
            var on = buttons[k].getAttribute('data-variant') === v;
            buttons[k].classList.toggle('is-on', on);
            buttons[k].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        document.body.setAttribute('data-zh-variant', v);
    }

    for (var b = 0; b < buttons.length; b++) {
        buttons[b].addEventListener('click', function () {
            var v = this.getAttribute('data-variant');
            store(v);
            apply(v);
        });
    }

    apply(read());
})();
