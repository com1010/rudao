# -*- coding: utf-8 -*-
"""2026-11-10 site edits: nav TOC removal, XiangQi casing, games/sitemap text,
chat input box moved to top, cache version bumps."""
import io, os, glob, re

ROOT = r"D:\RuDao-website"
LOG = []

def rd(p):
    with io.open(p, "r", encoding="utf-8") as f: return f.read()
def wr(p, s):
    with io.open(p, "w", encoding="utf-8", newline="") as f: f.write(s)

html_files = glob.glob(os.path.join(ROOT, "*.html")) + glob.glob(os.path.join(ROOT, "ch", "*.html"))
other_files = [os.path.join(ROOT, "llms.txt"), os.path.join(ROOT, "sitemap.xml")]

TOC_START = '<div class="nav-dropdown" id="tocDropdown">'
SM_START = '<div class="nav-dropdown" id="siteMapDropdown">'

REPL = [
    # specific before generic Xiangqi pass
    ("Board Games - WeiQi and Xiangqi \u68cb\u5f08", "Board Games - WeiQi \u56f4\u68cb \u8c61\u68cb"),
    ("Tony Tong <span class=\"zh\">\u5510\u4eea</span> has played WeiQi and Chinese chess all his life.",
     "Tony Tong <span class=\"zh\">\u5510\u4eea</span> has played WeiQi/Go and XiangQi / Chinese Chess all his life."),
    ("Brief History of the Three Boards <span class=\"zh\">\u68cb\u53f2\u7b80\u53d9</span>",
     "History of Chinese Board Games <span class=\"zh\">\u68cb\u53f2\u7b80\u53d9</span>"),
    ("Brief History of the Three Boards", "History of Chinese Board Games"),
    ("All 38 chapters \u5168\u4e66\u76ee\u5f55", "Table of Contents TOC \u5168\u4e66\u76ee\u5f55"),
]

def apply(p, s):
    # 1. remove TOC dropdown nav block
    i = s.find(TOC_START)
    if i >= 0:
        j = s.find(SM_START, i)
        assert j > i, p
        s = s[:i] + s[j:]
        LOG.append("toc nav removed: " + os.path.relpath(p, ROOT))
    # 2. text replacements
    for a, b in REPL:
        if a in s:
            n = s.count(a); s = s.replace(a, b)
            LOG.append("%dx [%s -> %s] in %s" % (n, a[:34], b[:34], os.path.relpath(p, ROOT)))
    # 3. generic casing (after specific replacements so new strings keep XiangQi)
    if "Xiangqi" in s:
        n = s.count("Xiangqi"); s = s.replace("Xiangqi", "XiangQi")
        LOG.append("%dx Xiangqi->XiangQi in %s" % (n, os.path.relpath(p, ROOT)))
    # 4. cache version bumps
    s = s.replace("chat-widget.js?v=20261109k", "chat-widget.js?v=20261110b")
    s = s.replace("styles.css?v=20261110a", "styles.css?v=20261110b")
    s = s.replace("styles.css?v=20261109l", "styles.css?v=20261110b")
    return s

for p in html_files + other_files:
    s0 = rd(p); s1 = apply(p, s0)
    if s1 != s0: wr(p, s1)

print("\n".join(LOG[:12]))
print("... total %d log entries" % len(LOG))
