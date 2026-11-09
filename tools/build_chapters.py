#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Split the 38 chapters of RuDao.org out of the single-page index.html into
38 standalone pages under /ch/<num><slug>.html, sharing the same <head>
(fonts + styles.css + inline chapter styles), the same fixed nav, the same
footer and the same scripts.

Run once from the site root:

    python tools/build_chapters.py

What it does
------------
1. reads  index.html
2. writes ch/<slug>.html   (38 files, "clean" URLs via Cloudflare Pages)
3. rewrites index.html:
      - removes the 38 chapter <section> blocks
      - repoints every  href="#<chapter-id>"  to the new /ch/<slug> URL
        (table of contents rows, nav dropdown, footer, in-text references)

After the split the chapter files are the source of truth for chapter text;
edit ch/*.html directly. The generator is kept only for the one-time split
and for regenerating the shared chrome.
"""

import json
import os
import re
import sys
import html as htmlmod

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
OUTDIR = os.path.join(ROOT, "ch")

BASE = "https://rudao.org"
ASSET_V = "20261108h"

# ---------------------------------------------------------------------------
# The 38 chapters, in reading order.
#   id    : the <section id="..."> in index.html
#   num   : the printed chapter number (TOC numbering, dots kept)
#   slug  : URL segment -> /ch/<slug>
#   nav   : short label used by the breadcrumb / prev-next pager
#   extra : additional section ids that live on the same page
# ---------------------------------------------------------------------------
CHAPTERS = [
    dict(id="preface",        num="0.0",   slug="00preface",                 nav="Front Matter - Preface 前文"),
    dict(id="opening-story",  num="0.1",   slug="01openingstory",            nav="Opening - My Journey to RuDao 序章"),
    dict(id="dedication",     num="0.2",   slug="02dedication",              nav="Dedication & Co-Editors 献言", extra=["coeditors"]),
    dict(id="ch03",           num="0.3",   slug="03purpose",                 nav="The Purpose of This Book 本书宗旨"),
    dict(id="ch05",           num="0.4",   slug="04whoshouldread",           nav="Who Should Read RuDao? 读者对象"),
    dict(id="chapter-one",    num="1.0",   slug="10roots",                   nav="The Roots 源 - Natural Pursuit of Profit 人性趋利"),
    dict(id="ch2",            num="2.0",   slug="20whatisrudao",             nav="What Is RuDao 何谓 儒+道"),
    dict(id="ch20",           num="2.1",   slug="21hundredschools",          nav="Hundred Schools 诸子百家"),
    dict(id="ch21",           num="2.2",   slug="22confucius",               nav="Confucius 551BC Ru-School 孔子 儒家"),
    dict(id="ch24",           num="2.3",   slug="23fiveconstants",           nav="Five Constants 五常 - 仁义礼智信"),
    dict(id="ch22",           num="2.4",   slug="24eightvirtues",            nav="RuShang Eight Virtues 儒商八德"),
    dict(id="ch30",           num="3.0",   slug="30innersage",               nav="Inner Sage, Outer King 内圣外王"),
    dict(id="ch31",           num="3.1",   slug="31daoism",                  nav="Daoism by LaoZi 571BC 老子 道家"),
    dict(id="ch32",           num="3.2",   slug="32ruanddao",                nav="Ru & Dao 儒与道"),
    dict(id="ch33",           num="3.3",   slug="33daoismstories",           nav="Daoism Stories: SaiWeng & LiaoFan's Lessons 塞翁失馬 了凡四训"),
    dict(id="ch331",          num="3.3.1", slug="331saiweng",                nav="SaiWeng's Lost Horse 塞翁失马"),
    dict(id="ch332",          num="3.3.2", slug="332liaofan",                nav="LiaoFan's Four Lessons 了凡四训"),
    dict(id="ch4",            num="4.0",   slug="40ruvsstrategists",         nav="Ru vs Strategists 儒家-兵家-竞合之道"),
    dict(id="ch41",           num="4.1",   slug="41artofwar",                nav="Art of War - SunTzu 544BC 孙子兵家"),
    dict(id="ch43",           num="4.2",   slug="42coopetition",             nav="Art of War vs Co-opetition 竞合之道"),
    dict(id="ch44",           num="4.3",   slug="43boardgame",               nav="Board Game - Boardroom 棋品见人品"),
    dict(id="ch50",           num="5.0",   slug="50rushangmerchant",         nav="RuShang Confucian Merchant 儒商典范"),
    dict(id="ch51",           num="5.1",   slug="51rushang",                 nav="RuShang Patriarchs FanLi ZiGong 儒商鼻祖"),
    dict(id="ch52",           num="5.2",   slug="52japan",                   nav="Japan - Analects & Abacus 日本儒商"),
    dict(id="ch531",          num="5.3.1", slug="531likashing",              nav="Li Ka-shing 李嘉诚 - 生意来求你"),
    dict(id="ch532",          num="5.3.2", slug="532robertkuok",             nav="Robert Kuok 郭鹤年 亚洲糖王"),
    dict(id="ch533",          num="5.3.3", slug="533luciotan",               nav="Lucio Tan 陈永栽 菲律宾儒商典范"),
    dict(id="ch534",          num="5.3.4", slug="534chenfamily",             nav="Chen Family 陈济棠三代 儒将儒商"),
    dict(id="ch6",            num="6.0",   slug="60aidigitalage",            nav="RuDao in the AI Digital Age 数字时代"),
    dict(id="ch61",           num="6.1",   slug="61ai5threvolution",         nav="AI 5th Industrial Revolution 第五次工业革命"),
    dict(id="ch62",           num="6.2",   slug="62dialogueofcivilizations", nav="Dialogue of Civilizations 文明对话"),
    dict(id="ch63",           num="6.3",   slug="63bizcases",                nav="Biz Case Studies 商业案例"),
    dict(id="ch64",           num="6.4",   slug="64internetfrontier",        nav="30 Years at the Internet Frontier"),
    dict(id="ch7",            num="7.0",   slug="70continuingjourney",       nav="Continuing the Journey 知行合一"),
    dict(id="appendix-a",     num="7.1",   slug="71quotes",                  nav="Appendix A - Quotes 名句集"),
    dict(id="glossary",       num="7.2",   slug="72glossary",                nav="Appendix B - Glossary 术语表"),
    dict(id="references",     num="7.3",   slug="73references",              nav="Sources & References 参考文献"),
    dict(id="huaxue",         num="7.4",   slug="74huaxue",                  nav="HuaXue 华学恩学"),
    dict(id="afterword",      num="7.5",   slug="75legacyoftong",            nav="Legacy of Tong Clan 唐氏传奇后记"),
    dict(id="ending-remark",  num="7.6",   slug="76endingremark",            nav="Ending Remark 结语"),
]

# anchor id -> chapter page slug (extra ids map to their host page)
ID2SLUG = {}
for _c in CHAPTERS:
    ID2SLUG[_c["id"]] = _c["slug"]
    for _x in _c.get("extra", []):
        ID2SLUG[_x] = _c["slug"]

NUM2PAGE = {c["num"]: c for c in CHAPTERS}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def top_level_sections(s):
    """Return [(id, start, end)] for every top-level <section>."""
    tag = re.compile(r"</?section\b[^>]*>")
    depth = 0
    out = []
    for m in tag.finditer(s):
        g = m.group(0)
        if g.startswith("</"):
            depth -= 1
        else:
            if depth == 0:
                idm = re.search(r'id="([^"]+)"', g)
                out.append([idm.group(1) if idm else "", m.start(), None])
            depth += 1
        if depth == 0 and out and out[-1][2] is None:
            out[-1][2] = m.end()
    return [(i, a, b) for i, a, b in out if b]


def plain(fragment):
    txt = re.sub(r"<[^>]+>", "", fragment)
    txt = htmlmod.unescape(txt)
    txt = re.sub(r"\s+", " ", txt)
    txt = re.sub(r"\(\s+", "(", txt)
    txt = re.sub(r"\s+\)", ")", txt)
    txt = re.sub(r"\s+([,.;:!?])", r"\1", txt)
    return txt.strip()


def strip_hash(txt):
    return re.sub(r"\s*#\s*$", "", txt).strip()


def indent(block, spaces):
    pad = " " * spaces
    return "\n".join(pad + ln if ln.strip() else ln for ln in block.splitlines())


# ---------------------------------------------------------------------------
# read source
# ---------------------------------------------------------------------------
src = open(SRC, encoding="utf-8").read()

sections = dict()
for sid, a, b in top_level_sections(src):
    sections[sid] = (a, b)

missing = [c["id"] for c in CHAPTERS if c["id"] not in sections]
if missing:
    sys.exit("These chapter sections are not in index.html any more: %s\n"
             "(the split has probably already been run)" % ", ".join(missing))

HEAD_END = src.index("</head>") + len("</head>")
head = src[:HEAD_END]

NAV_START = src.index('<header class="nav" id="nav">')
NAV_END = src.index("</header>", NAV_START) + len("</header>")
nav = src[NAV_START:NAV_END]

FOOT_START = src.index('<footer class="footer">')
FOOT_END = src.index("</footer>", FOOT_START) + len("</footer>")
footer = src[FOOT_START:FOOT_END]

BODY_END = src.index("</body>")
scripts = src[FOOT_END:BODY_END]


def fix_asset_paths(text):
    """css/ js/ assets/ fonts/ -> root-relative, so /ch/x.html resolves them."""
    text = re.sub(r'(href|src)="(css|js|assets|fonts)/', r'\1="/\2/', text)
    text = text.replace("url('fonts/", "url('/fonts/")
    text = text.replace('url("fonts/', 'url("/fonts/')
    return text


def rewrite_fragments(text, current_page_ids):
    """href="#x" -> /ch/<slug> when x belongs to another chapter page."""
    def repl(m):
        target = m.group(1)
        if target in current_page_ids:
            return 'href="#%s"' % target
        if target in ID2SLUG:
            slug = ID2SLUG[target]
            return 'href="/ch/%s"' % slug
        # non-chapter anchors only exist on the landing page
        return 'href="/#%s"' % target
    return re.sub(r'href="#([^"#]+)"', repl, text)


# ---------------------------------------------------------------------------
# build the shared chrome (nav / footer / scripts) once
# ---------------------------------------------------------------------------
nav_common = rewrite_fragments(fix_asset_paths(nav), set())
foot_common = rewrite_fragments(fix_asset_paths(footer), set())
scripts_common = fix_asset_paths(scripts)


def build_head(page):
    h = head

    # assets live at the site root
    h = fix_asset_paths(h)
    h = h.replace("css/styles.css?v=20261108g", "css/styles.css?v=%s" % ASSET_V)

    # drop the four book-level JSON-LD blocks, a chapter page gets its own
    h = re.sub(r'\n\s*<script type="application/ld\+json">.*?</script>', "", h, flags=re.S)

    url = "%s/ch/%s" % (BASE, page["slug"])
    title = "%s %s | RuDao 儒道" % (page["num"], page["nav"])

    h = re.sub(r"<title>.*?</title>", "<title>%s</title>" % title, h, flags=re.S)

    desc = page["desc"]
    h = re.sub(r'<meta name="description" content="[^"]*" />',
               '<meta name="description" content="%s" />' % desc, h)

    # canonical + language alternates now point at the chapter itself
    h = re.sub(
        r'<link rel="canonical" href="[^"]*" />(\s*<link rel="alternate" href="[^"]*" hreflang="[^"]*" />)+',
        ('<link rel="canonical" href="%s" />\n'
         '    <link rel="alternate" href="%s" hreflang="en" />\n'
         '    <link rel="alternate" href="%s" hreflang="zh-Hans" />\n'
         '    <link rel="alternate" href="%s" hreflang="x-default" />') % (url, url, url, url),
        h)

    h = re.sub(r'<meta property="og:url" content="[^"]*" />',
               '<meta property="og:url" content="%s" />' % url, h)
    h = re.sub(r'<meta property="og:title" content="[^"]*" />',
               '<meta property="og:title" content="%s" />' % title.replace('"', "&quot;"), h)
    h = re.sub(r'<meta property="og:description" content="[^"]*" />',
               '<meta property="og:description" content="%s" />' % desc, h)
    h = re.sub(r'<meta name="twitter:title" content="[^"]*" />',
               '<meta name="twitter:title" content="%s" />' % title.replace('"', "&quot;"), h)
    h = re.sub(r'<meta name="twitter:description" content="[^"]*" />',
               '<meta name="twitter:description" content="%s" />' % desc, h)
    h = re.sub(r'<meta property="og:type" content="book" />',
               '<meta property="og:type" content="article" />', h)

    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "RuDao 儒道", "item": BASE + "/"},
                    {"@type": "ListItem", "position": 2, "name": "Table of Contents 目录", "item": BASE + "/#contents"},
                    {"@type": "ListItem", "position": 3,
                     "name": "%s %s" % (page["num"], page["nav"]), "item": url},
                ],
            },
            {
                "@type": "Chapter",
                "name": page["title_plain"],
                "headline": "%s %s" % (page["num"], page["title_plain"]),
                "url": url,
                "position": page["position"],
                "inLanguage": ["en", "zh-Hans"],
                "isPartOf": {
                    "@type": "Book",
                    "name": "RuDao 儒道 - Beyond The Art of War",
                    "url": BASE + "/",
                    "author": {"@type": "Person", "name": "Tony Tong (唐仪)", "url": "https://TonyTong.cc"},
                },
                "author": {"@type": "Person", "name": "Tony Tong (唐仪)", "url": "https://TonyTong.cc"},
                "publisher": {"@type": "Organization", "name": "RuDao.org", "url": BASE + "/"},
            },
        ],
    }
    h = h.replace("</head>",
                  '    <script type="application/ld+json">\n%s\n    </script>\n</head>'
                  % json.dumps(ld, ensure_ascii=False, indent=2))
    return h


def build_page(page, body_html):
    prev_c = NUM2PAGE.get(page["prev"]) if page["prev"] else None
    next_c = NUM2PAGE.get(page["next"]) if page["next"] else None

    pager = ['        <nav class="ch-pager" aria-label="Chapter navigation">',
             '            <div class="ch-pager-grid">']
    if prev_c:
        pager.append('                <a class="ch-pager-link prev" href="/ch/%s">'
                     '<span class="dir">&larr; Previous 上一章</span>'
                     '<span class="ttl">%s %s</span></a>'
                     % (prev_c["slug"], prev_c["num"], prev_c["nav"]))
    else:
        pager.append('                <span class="ch-pager-link is-empty" aria-hidden="true"></span>')
    if next_c:
        pager.append('                <a class="ch-pager-link next" href="/ch/%s">'
                     '<span class="dir">Next 下一章 &rarr;</span>'
                     '<span class="ttl">%s %s</span></a>'
                     % (next_c["slug"], next_c["num"], next_c["nav"]))
    else:
        pager.append('                <span class="ch-pager-link is-empty" aria-hidden="true"></span>')
    pager.append('                <a class="ch-pager-toc" href="/#contents">'
                 'Full Table of Contents 完整目录</a>')
    pager.append("            </div>")
    pager.append("        </nav>")

    crumb = (
        '        <nav class="ch-crumb" aria-label="Breadcrumb">\n'
        '            <div class="ch-crumb-inner">\n'
        '                <a href="/">RuDao 儒道</a>\n'
        '                <span class="sep">&rsaquo;</span>\n'
        '                <a href="/#contents">Contents 目录</a>\n'
        '                <span class="sep">&rsaquo;</span>\n'
        '                <span class="here">%s &middot; %s</span>\n'
        '            </div>\n'
        '        </nav>\n' % (page["num"], page["nav"])
    )

    return (
        build_head(page)
        + '\n<body class="ch-body">\n\n'
        + indent(nav_common, 4)
        + "\n\n    <main class=\"ch-main\">\n"
        + crumb
        + "\n" + indent(body_html, 8) + "\n\n"
        + indent("\n".join(pager), 4)
        + "\n    </main>\n\n"
        + indent(foot_common, 4)
        + "\n\n" + scripts_common.strip() + "\n\n</body>\n</html>\n"
    )


# ---------------------------------------------------------------------------
# go
# ---------------------------------------------------------------------------
os.makedirs(OUTDIR, exist_ok=True)

for i, page in enumerate(CHAPTERS):
    page["position"] = i + 1
    page["prev"] = CHAPTERS[i - 1]["num"] if i > 0 else None
    page["next"] = CHAPTERS[i + 1]["num"] if i + 1 < len(CHAPTERS) else None

    a, b = sections[page["id"]]
    body = src[a:b]
    page_ids = {page["id"]} | set(page.get("extra", []))

    # append the sections that share this page (coeditors -> dedication)
    for extra_id in page.get("extra", []):
        ea, eb = sections[extra_id]
        body += "\n\n" + src[ea:eb]

    blk = body
    num_span = re.search(r'<span class="section-num">(.*?)</span>', blk, re.S)
    title_h2 = re.search(r'<h2 class="section-title">(.*?)</h2>', blk, re.S)
    sub = re.search(r'<p class="section-subtitle">(.*?)</p>', blk, re.S)

    page["num_label"] = plain(num_span.group(1)) if num_span else page["num"]
    page["title_plain"] = strip_hash(plain(title_h2.group(1))) if title_h2 else page["nav"]
    desc = strip_hash(plain(sub.group(1))) if sub else ""
    if len(desc) < 60:
        body_part = re.search(r'<div class="preface-body">(.*?)</div>', blk, re.S)
        scope = body_part.group(1) if body_part else blk
        for p in re.finditer(r"<p[^>]*>(.*?)</p>", scope, re.S):
            cand = plain(p.group(1))
            if len(cand) > 60:
                desc = cand
                break
    if len(desc) > 158:
        desc = desc[:155].rsplit(" ", 1)[0].rstrip(",;:") + "..."
    page["desc"] = desc.replace('"', "&quot;")

    body = rewrite_fragments(fix_asset_paths(body), page_ids)

    out = build_page(page, body)
    path = os.path.join(OUTDIR, page["slug"] + ".html")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out)
    print("wrote ch/%s.html  (%d KB)  %s" % (page["slug"], len(out) // 1024, page["title_plain"]))

# ---------------------------------------------------------------------------
# rewrite index.html: chapters live on their own pages now
# ---------------------------------------------------------------------------
start = sections[CHAPTERS[0]["id"]][0]
end = sections[CHAPTERS[-1]["id"]][1]

stub = ('    <!-- ===========================================================\n'
        '         The 38 chapters live on their own pages now: /ch/<num><slug>\n'
        '         (full map: tools/build_chapters.py). The table of contents\n'
        '         above and the nav dropdown link straight to them.\n'
        '         =========================================================== -->\n')

new_src = src[:start] + stub + src[end:]

# a one-line note under the table of contents
toc_note = ('            <p class="toc-note">Every chapter now has its own page - '
            'click any row above to open it. 每一章都有独立页面,点击目录即可阅读。</p>\n')
anchor = '                </tbody>\n            </table>\n'
if anchor in new_src:
    new_src = new_src.replace(anchor, anchor + toc_note, 1)

# every reference to a chapter anchor now points at the chapter page
def repl_idx(m):
    target = m.group(1)
    if target in ID2SLUG:
        return 'href="/ch/%s"' % ID2SLUG[target]
    return m.group(0)

new_src = re.sub(r'href="#([^"#]+)"', repl_idx, new_src)

with open(SRC, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(new_src)

print("\nindex.html: %d KB -> %d KB" % (len(src) // 1024, len(new_src) // 1024))
print("chapters written: %d" % len(CHAPTERS))
