# -*- coding: utf-8 -*-
"""
Shared link catalogue for RuDao.org.

One source of truth for:
  * the human-readable /sitemap page,
  * the "Site Map" dropdown in the top navigation bar,
  * the TOC dropdown used on the new classic-text pages.

The chapter rows are read from games.html so the wording stays identical to
the table of contents that ships on every page of the site.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = "20261109e"

# ---------------------------------------------------------------------------
# Static site links. Every entry here is also rendered into the nav dropdown.
# (group heading, [(href, english label, chinese label, note)])
# ---------------------------------------------------------------------------
TOP_GROUPS = [
    (
        "Start here",
        [
            ("/", "Home - RuDao: Beyond The Art of War", "儒道 全书", "The full bilingual book, one page with the complete table of contents."),
            ("/#contents", "Full Table of Contents", "完整目录", "All 38 chapter pages, grouped from front matter to back matter."),
            ("/#author", "About the author - Tony Tong", "作者 唐仪", "Biography, the book's origins and the author's other work."),
            ("/#endorsements", "Reviews and Readers' Blog", "读者评语留言", "Reader reviews, endorsements and the message board."),
            ("/#h5app", "H5 offline reader app", "离线版", "Download the whole book as a self-contained HTML5 app."),
        ],
    ),
    (
        "Study, ask and play",
        [
            ("/guide", "Study Guide", "导读", "Eight plain-English answers on Confucian business ethics and co-opetition."),
            ("/faq", "FAQ", "常见问题", "Short answers about the book, the author and the ideas."),
            ("/consult", "Consultation with Tony Tong", "咨询预约", "Book a 15-minute one-to-one conversation with the author."),
            ("/games", "Board Games - WeiQi and Xiangqi", "棋弈", "Two playable boards from Chapter 4.3, with bilingual spoken cues."),
            ("/games#gm-guide", "Bilingual beginner game guide", "双语入门", "The rules of Go and Chinese chess in English and Chinese."),
        ],
    ),
    (
        "The Chinese classics - full original text",
        [
            ("/ch/lunyu", "LunYu - The Analects of Confucius", "论语", "All 20 books, about 15,900 characters, simplified and original characters."),
            ("/ch/daodejing", "DaoDeJing - Tao Te Ching", "道德经", "All 81 chapters of the Five Thousand Characters, simplified and original characters."),
            ("/ch/artofwar", "The Art of War - SunTzu", "孙子兵法", "All 13 chapters, about 6,000 characters, simplified and original characters."),
            ("/sitemap", "Site Map", "网站地图", "This page: every link on RuDao.org in one place."),
        ],
    ),
]

CHAPTER_GROUPS = [
    ("0", "Front Matter 前文"),
    ("1", "Chapter 1 - The Roots 源 趋利"),
    ("2", "Chapter 2 - What Is RuDao 哲学伦理"),
    ("3", "Chapter 3 - Inner Sage, Outer King 内圣外王"),
    ("4", "Chapter 4 - Ru vs Strategists 竞合之道"),
    ("5", "Chapter 5 - RuShang 儒商典范"),
    ("6", "Chapter 6 - The AI Digital Age 数字时代"),
    ("7", "Back Matter 后文"),
]


def read_chapter_rows() -> list[dict]:
    """Pull the exact TOC labels out of games.html."""
    src = (ROOT / "games.html").read_text(encoding="utf-8")
    pattern = re.compile(
        r'<a class="nav-drop(group|item)" href="([^"]+)"[^>]*>'
        r'<span class="nav-dropnum">([^<]*)</span>'
        r'<span class="nav-droplabel">([^<]*)</span></a>'
    )
    rows = []
    seen = set()
    num_re = re.compile(r"^\d+(?:\.\d+)*$")
    for kind, href, num, label in pattern.findall(src):
        num = html.unescape(num).strip()
        # games.html is also patched by build_sitemap.py, so the same file
        # contains the Site Map dropdown and the Appendix C group. Only the
        # numbered book chapters belong here, and each number appears once.
        if not num_re.match(num) or num in seen:
            continue
        seen.add(num)
        rows.append({
            "kind": kind,
            "href": href,
            "num": num,
            "label": html.unescape(label).strip(),
        })
    # 40 numbered TOC rows cover 38 chapter pages (two group rows share a page).
    if not 38 <= len(rows) <= 45:  # pragma: no cover - guard against a changed template
        raise RuntimeError(
            "Unexpected table of contents in games.html: %d rows" % len(rows)
        )
    return rows


CHAPTERS = read_chapter_rows()


def all_links() -> list[tuple[str, str]]:
    """Flat list of (href, label) for everything on the site map page."""
    out = []
    for _heading, links in TOP_GROUPS:
        for href, en, zh, _note in links:
            out.append((href, en + " " + zh))
    for row in CHAPTERS:
        out.append((row["href"], row["num"] + " " + row["label"]))
    return out


# ---------------------------------------------------------------------------
# Navigation markup
# ---------------------------------------------------------------------------
CLASSICS_GROUP = [
    '                        <a class="nav-dropgroup" href="/sitemap#classics" role="menuitem"><span class="nav-dropnum">C</span><span class="nav-droplabel">Appendix C - Chinese Classics 典籍原文</span></a>',
    '                        <a class="nav-dropitem" href="/ch/lunyu" role="menuitem"><span class="nav-dropnum">C.1</span><span class="nav-droplabel">LunYu - The Analects 论语全文</span></a>',
    '                        <a class="nav-dropitem" href="/ch/daodejing" role="menuitem"><span class="nav-dropnum">C.2</span><span class="nav-droplabel">DaoDeJing 道德经全文</span></a>',
    '                        <a class="nav-dropitem" href="/ch/artofwar" role="menuitem"><span class="nav-dropnum">C.3</span><span class="nav-droplabel">Art of War 孙子兵法全文</span></a>',
]


def toc_dropdown(prefix: str = "/") -> str:
    """The existing TOC dropdown, for the new pages."""
    lines = [
        '                <div class="nav-dropdown" id="tocDropdown">',
        '                    <button type="button" class="nav-dropbtn" id="tocDropBtn" aria-haspopup="true" aria-expanded="false" aria-controls="tocDropMenu">',
        '                        TOC 目录 <span class="nav-caret" aria-hidden="true">&#9662;</span>',
        '                    </button>',
        '                    <div class="nav-dropmenu" id="tocDropMenu" role="menu" aria-label="Table of contents">',
        '                        <a class="nav-dropfull" href="' + prefix + '#contents" role="menuitem">Full Table of Contents 完整目录</a>',
    ]
    for row in CHAPTERS:
        href = row["href"]
        if not href.startswith("/"):
            href = "/" + href
        lines.append(
            '                        <a class="nav-drop%s" href="%s" role="menuitem"><span class="nav-dropnum">%s</span><span class="nav-droplabel">%s</span></a>'
            % (row["kind"], href, html.escape(row["num"]), html.escape(row["label"]))
        )
    lines += CLASSICS_GROUP
    lines += [
        '                    </div>',
        '                </div>',
    ]
    return "\n".join(lines)


def sitemap_dropdown() -> str:
    """The new Site Map dropdown. Contains every link on the site map page."""
    lines = [
        '                <div class="nav-dropdown" id="siteMapDropdown">',
        '                    <button type="button" class="nav-dropbtn" id="siteMapDropBtn" aria-haspopup="true" aria-expanded="false" aria-controls="siteMapDropMenu">',
        '                        Site Map 地图 <span class="nav-caret" aria-hidden="true">&#9662;</span>',
        '                    </button>',
        '                    <div class="nav-dropmenu" id="siteMapDropMenu" role="menu" aria-label="Site map">',
        '                        <a class="nav-dropfull" href="/sitemap" role="menuitem">Full Site Map 完整网站地图 &rarr;</a>',
    ]
    for heading, links in TOP_GROUPS:
        lines.append('                        <a class="nav-dropgroup" href="/sitemap" role="menuitem"><span class="nav-dropnum">&bull;</span><span class="nav-droplabel">%s</span></a>' % html.escape(heading))
        for href, en, zh, _note in links:
            label = html.escape("%s %s" % (en, zh))
            lines.append('                        <a class="nav-dropitem" href="%s" role="menuitem"><span class="nav-dropnum">&middot;</span><span class="nav-droplabel">%s</span></a>' % (href, label))
    lines.append('                        <a class="nav-dropgroup" href="/sitemap" role="menuitem"><span class="nav-dropnum">&bull;</span><span class="nav-droplabel">All 38 chapters 全书目录</span></a>')
    for row in CHAPTERS:
        href = row["href"]
        if not href.startswith("/"):
            href = "/" + href
        lines.append(
            '                        <a class="nav-dropitem" href="%s" role="menuitem"><span class="nav-dropnum">%s</span><span class="nav-droplabel">%s</span></a>'
            % (href, html.escape(row["num"]), html.escape(row["label"]))
        )
    lines += [
        '                    </div>',
        '                </div>',
    ]
    return "\n".join(lines)


def full_nav(current: str = "") -> str:
    """Full fixed navigation for a new page."""
    aria = ' aria-current="page"' if current == "/games" else ""
    return "\n".join([
        '    <header class="nav" id="nav">',
        '        <div class="nav-inner">',
        '            <a href="https://rudao.org" class="nav-brand" title="RuDao.org">',
        '                <span class="brand-en">RuDao</span>',
        '                <span class="brand-cn">儒道</span>',
        '            </a>',
        '            <nav class="nav-links">',
        toc_dropdown(),
        sitemap_dropdown(),
        '                <a href="/#author">Author</a>',
        '                <a class="nav-hide-sm" href="/#endorsements">Reviews 读者评语</a>',
        '                <a class="nav-hide-sm" href="/#h5app">H5 App 离线版</a>',
        '                <a href="/games"%s>Board Games 棋弈</a>' % aria,
        '            </nav>',
        '        </div>',
        '    </header>',
    ])


def head_link_tags() -> str:
    return (
        '<link rel="stylesheet" href="/css/styles.css?v=%s" />\n'
        '<link rel="stylesheet" href="/css/classics.css?v=%s" />'
        % (CACHE, CACHE)
    )


def font_tags() -> str:
    return (
        '<link rel="preconnect" href="https://fonts.googleapis.com" />\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n'
        '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&family=Quintessential&family=Merriweather:wght@300;400;700&family=Noto+Serif+SC:wght@400;500;600;700&display=swap" rel="stylesheet" />'
    )


def tail_scripts() -> str:
    return "\n".join([
        '<script src="/js/zh-wrap.js?v=%s"></script>' % CACHE,
        '<script src="/js/nav-sitemap.js?v=%s"></script>' % CACHE,
        '<script src="/js/classics.js?v=%s"></script>' % CACHE,
        '<script src="/js/chat-widget.js?v=%s" defer></script>' % CACHE,
    ])
