/**
 * RuDao.org - top navigation dropdowns
 * ------------------------------------------------------------
 * Binds the Site Map dropdown on every page. On the new pages (which carry
 * data-nav-dropdowns on <body>) it also binds the TOC dropdown, because those
 * pages do not ship the legacy inline TOC script. Only one menu is open at a
 * time; Escape and outside clicks close it.
 */
(function () {
    'use strict';

    var generic = document.body && document.body.hasAttribute('data-nav-dropdowns');
    var ids = generic ? ['tocDropdown', 'siteMapDropdown'] : ['siteMapDropdown'];
    var items = [];

    /* Older pages ship their own inline TOC script. We must not bind that
       button a second time (two toggles would cancel each other), but the
       two menus still have to be mutually exclusive. */
    var legacyToc = (!generic) ? document.getElementById('tocDropdown') : null;
    var legacyBtn = legacyToc && legacyToc.querySelector('.nav-dropbtn');
    function closeLegacyToc() {
        if (!legacyToc) return;
        legacyToc.classList.remove('open');
        if (legacyBtn) legacyBtn.setAttribute('aria-expanded', 'false');
    }
    if (legacyBtn) {
        legacyBtn.addEventListener('click', function () {
            var dd = document.getElementById('siteMapDropdown');
            if (!dd) return;
            dd.classList.remove('open');
            var b = dd.querySelector('.nav-dropbtn');
            if (b) b.setAttribute('aria-expanded', 'false');
        }, true);
    }

    for (var i = 0; i < ids.length; i++) {
        var dd = document.getElementById(ids[i]);
        var btn = dd && dd.querySelector('.nav-dropbtn');
        if (dd && btn) items.push({ dd: dd, btn: btn });
    }
    if (!items.length) return;

    function closeAll(except) {
        for (var i = 0; i < items.length; i++) {
            if (items[i] === except) continue;
            items[i].dd.classList.remove('open');
            items[i].btn.setAttribute('aria-expanded', 'false');
        }
    }

    for (var j = 0; j < items.length; j++) {
        (function (item) {
            item.btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var open = !item.dd.classList.contains('open');
                closeAll();
                closeLegacyToc();
                item.dd.classList.toggle('open', open);
                item.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
            var links = item.dd.querySelectorAll('.nav-dropmenu a');
            for (var k = 0; k < links.length; k++) {
                links[k].addEventListener('click', function () { closeAll(); });
            }
        })(items[j]);
    }

    document.addEventListener('click', function (e) {
        for (var i = 0; i < items.length; i++) {
            if (!items[i].dd.contains(e.target)) closeAll();
        }
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.keyCode === 27) closeAll();
    });
})();
