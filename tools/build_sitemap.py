# -*- coding: utf-8 -*-
"""
Build /sitemap (the human-readable site map) and add the matching
"Site Map" dropdown to the top navigation bar of every page.

  * sitemap.html      - one page listing every link on RuDao.org
  * nav dropdown      - same links, injected into all existing pages
  * css/classics.css  - loaded everywhere (also holds the nav additions)
  * js/nav-sitemap.js - dropdown behaviour, loaded everywhere
  * cache versions     - styles.css / chat-widget.js bumped after edits

Run:  python tools/build_sitemap.py
Idempotent: re-running does not duplicate the dropdown or the CSS link.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

from site_data import (
    ROOT, CACHE, CHAPTERS, TOP_GROUPS, CLASSICS_GROUP,
    CHAPTER_GROUPS, font_tags, head_link_tags, full_nav,
    sitemap_dropdown, tail_scripts,
)

NEW_PAGES = {"ch/lunyu.html", "ch/daodejing.html", "ch/artofwar.html", "sitemap.html"}
SKIP_NAMES = {"admin-chat-log.html"}


def esc(s: str) -> str:
    return html.escape(s, quote=False)


# ---------------------------------------------------------------------------
# 1. sitemap.html
# ---------------------------------------------------------------------------
def site_map_page() -> str:
    head = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Site Map 网站地图 - Every Page on RuDao.org</title>
<meta name="description" content="The complete site map of RuDao.org: the book and its 38 chapters, the study guide, FAQ, consultation page, playable WeiQi and Chinese Chess boards, and the full original Chinese text of LunYu, DaoDeJing and The Art of War." />
<meta name="keywords" content="RuDao site map, 网站地图, RuDao chapters, 论语, 道德经, 孙子兵法, LunYu, DaoDeJing, Art of War, Board Games, WeiQi, Xiangqi" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="https://rudao.org/sitemap" />
<link rel="author" href="https://TonyTong.cc" />
<meta property="og:type" content="website" />
<meta property="og:title" content="Site Map 网站地图 - Every Page on RuDao.org" />
<meta property="og:description" content="Every page on RuDao.org in one place: 38 chapters, three Chinese classics, study guide, FAQ, consultation and the playable board games." />
<meta property="og:url" content="https://rudao.org/sitemap" />
<meta property="og:image" content="https://rudao.org/assets/rudao-cover-primary.jpg" />
{fonts}
{links}
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Site Map 网站地图 - RuDao.org",
  "url": "https://rudao.org/sitemap",
  "description": "Every page on RuDao.org, grouped by section.",
  "isPartOf": {{"@type": "WebSite", "name": "RuDao", "url": "https://rudao.org/"}}
}}
</script>
</head>
<body class="cl-body sm-body" data-nav-dropdowns="generic">
""".format(fonts=font_tags(), links=head_link_tags())

    hero = """{nav}
<main class="cl-main">
<section class="cl-hero">
  <div class="container cl-wrap">
    <p class="cl-kicker">RuDao.org &middot; every page</p>
    <h1 class="cl-h1"><span class="cl-h1-en">Site Map</span> <span class="zh">网站地图</span></h1>
    <p class="cl-sub">One page, every link on this site.</p>
    <p class="cl-lead">RuDao is one bilingual book with a page for each of its 38 chapters, plus study notes, two playable board games and the complete original Chinese text of the three classics the book argues with. Everything is listed below, and the same list is in the <em>Site Map</em> menu in the top navigation bar.</p>
    <p class="cl-lead-cn">全书三十八章各有独立页面,另有导读、常见问题、咨询、围棋与象棋棋盘,以及《论语》《道德经》《孙子兵法》三部典籍中文全文。下方列出全站链接,顶栏「网站地图」下拉菜单与此完全一致。</p>
    <p class="cl-stats"><span>38 chapters 全书目录</span><span>3 Chinese classics 典籍全文</span><span>{n} links 站内链接</span></p>
  </div>
</section>
""".format(nav=full_nav(), n=sum(len(x[1]) for x in TOP_GROUPS) + len(CHAPTERS))

    parts = [head, hero, '<section class="cl-toc">', '  <div class="container cl-wrap">',
             '    <h2 class="cl-h2">All links 全站链接</h2>',
             '    <p class="sm-legend">Internal links only. External author and social profiles are listed on the <a href="/">home page 首页</a>.</p>']

    for heading, links in TOP_GROUPS:
        anchor = ' id="classics"' if heading.startswith("The Chinese classics") else ''
        parts.append('    <section class="sm-group sm-anchor"%s>' % anchor)
        parts.append('      <h3 class="cl-h2">%s</h3>' % esc(heading))
        parts.append('      <ul class="sm-grid">')
        for href, en, zh, note in links:
            label = esc("%s %s" % (en, zh))
            parts.append('        <li><a href="%s">%s</a><span class="sm-note">%s</span></li>' % (href, label, esc(note)))
        parts += ['      </ul>', '    </section>']

    parts.append('    <section class="sm-group sm-anchor" id="chapters">')
    parts.append('      <h3 class="cl-h2">All 38 chapters 全书目录</h3>')
    parts.append('      <ul class="sm-grid">')
    current = None
    for row in CHAPTERS:
        key = row["num"].split(".")[0]
        if key in dict(CHAPTER_GROUPS) and key != current:
            current = key
            parts.append('        <li class="cl-toc-group">%s</li>' % esc(dict(CHAPTER_GROUPS)[key]))
        parts.append('        <li><a href="%s"><span class="sm-num">%s</span>%s</a></li>' %
                     (row["href"], esc(row["num"]), esc(row["label"])))
    parts += ['      </ul>', '    </section>']

    parts += ['    <section class="sm-group">',
              '      <h3 class="cl-h2">Machine-readable versions</h3>',
              '      <ul class="sm-grid">',
              '        <li><a href="/sitemap.xml">sitemap.xml</a><span class="sm-note">XML sitemap for search engines.</span></li>',
              '        <li><a href="/llms.txt">llms.txt</a><span class="sm-note">Plain-text summary of the book for AI readers.</span></li>',
              '        <li><a href="/robots.txt">robots.txt</a><span class="sm-note">Crawler rules and sitemap location.</span></li>',
              '      </ul>', '    </section>',
              '  </div>', '</section>', '</main>',
              '<footer class="cl-foot"><div class="container cl-wrap">',
              '  <p>RuDao 儒道 - Beyond The Art of War. A bilingual book by Tony Tong 唐仪. &copy; 2026 <a href="https://TonyTong.cc">TonyTong.cc</a>.</p>',
              '</div></footer>', tail_scripts(), '</body>', '</html>', '']
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 2. Inject into existing pages
# ---------------------------------------------------------------------------
def targets() -> list[Path]:
    out = [ROOT / "index.html"]
    out += sorted((ROOT / "ch").glob("*.html"))
    for name in ("guide.html", "faq.html", "consult.html", "games.html"):
        out.append(ROOT / name)
    return out


def patch(path: Path) -> str:
    s = path.read_text(encoding="utf-8")
    rel = path.relative_to(ROOT).as_posix()
    notes = []

    # cache-bust the shared assets (also the ones injected by an earlier run)
    s2 = re.sub(r'(styles\.css\?v=)[0-9a-zA-Z]+', r'\g<1>' + CACHE, s)
    for asset in ('chat-widget.js', 'classics.css', 'classics.js',
                  'nav-sitemap.js', 'zh-wrap.js'):
        s2 = re.sub(r'(' + re.escape(asset) + r'\?v=)[0-9a-zA-Z]+',
                    r'\g<1>' + CACHE, s2)
    if s2 != s:
        notes.append("versions")
    s = s2

    # shared stylesheet for the new dropdown / classic cross-reference boxes
    if "/css/classics.css" not in s:
        s = s.replace("</head>", '    <link rel="stylesheet" href="/css/classics.css?v=%s" />\n</head>' % CACHE, 1)
        notes.append("css")

    # shared dropdown behaviour
    if "/js/nav-sitemap.js" not in s:
        s = s.replace("</body>", '    <script src="/js/nav-sitemap.js?v=%s"></script>\n</body>' % CACHE, 1)
        notes.append("js")

    is_new = rel in NEW_PAGES
    if not is_new:
        # Appendix C group inside the existing TOC dropdown
        m = re.search(r'(<div class="nav-dropmenu" id="tocDropMenu"[^>]*>)(.*?)(\s*</div>\s*</div>)', s, re.S)
        if m and "Appendix C - Chinese Classics" not in m.group(2):
            s = s[:m.start(3)] + "\n" + "\n".join(CLASSICS_GROUP) + s[m.start(3):]
            notes.append("toc-group")

        # Site Map dropdown. Rebuild it on every run so a changed link
        # catalogue is always reflected, and re-running never duplicates it.
        existing = re.search(
            r'[ \t]*<div class="nav-dropdown" id="siteMapDropdown">.*?</div>\s*\n[ \t]*</div>',
            s, re.S)
        if existing:
            fresh = sitemap_dropdown()
            if fresh not in s:
                s = s[:existing.start()] + fresh + s[existing.end():]
                notes.append("dropdown-refresh")
        else:
            m = re.search(r'(<a\s+href="[^"]*#author"[^>]*>Author</a>)', s)
            if m:
                s = s[:m.start(1)] + sitemap_dropdown() + "\n" + s[m.start(1):]
                notes.append("dropdown-nav")
            else:
                # guide / faq / consult use a slim top bar instead of the full nav
                m2 = re.search(r'(<div class="(?:gd|cs)-bar-in">)(.*?)(</div>)', s, re.S)
                if m2:
                    s = s[:m2.start(3)] + "        " + sitemap_dropdown().strip() + "\n    " + s[m2.start(3):]
                    notes.append("dropdown-bar")

        # hide two lower-priority top-level links on small screens
        def hide(mo):
            tag = mo.group(0)
            if "class=" in tag:
                return tag
            return tag.replace("<a ", '<a class="nav-hide-sm" ', 1)
        s2 = re.sub(r'<a href="[^"]*#endorsements"[^>]*>\s*Reviews[^<]*</a>', hide, s)
        s2 = re.sub(r'<a href="[^"]*#h5app"[^>]*>\s*H5 App[^<]*</a>', hide, s2)
        if s2 != s:
            notes.append("mobile-hide")
        s = s2

    path.write_text(s, encoding="utf-8", newline="")
    return ", ".join(notes) or "unchanged"


def main() -> None:
    (ROOT / "sitemap.html").write_text(site_map_page(), encoding="utf-8", newline="\n")
    print("sitemap.html written")
    for p in targets():
        if p.name in SKIP_NAMES:
            continue
        print("%-42s %s" % (p.relative_to(ROOT).as_posix(), patch(p)))


if __name__ == "__main__":
    main()
