# -*- coding: utf-8 -*-
"""Renumber chapters 2.3->2.4, 2.4->2.5, insert new 2.3 Mencius page."""
import re, os, glob, io

ROOT = r"D:\RuDao-website"
LOG = []

def rd(p):
    with io.open(p, "r", encoding="utf-8") as f: return f.read()
def wr(p, s):
    with io.open(p, "w", encoding="utf-8", newline="") as f: f.write(s)

# ---------- ordered replacements (slug first, then display numbers, later first) ----------
SLUG_REPL = [
    ("24eightvirtues", "25eightvirtues"),
    ("23fiveconstants", "24fiveconstants"),
]
DISPLAY_REPL = [
    # 2.4 -> 2.5 first
    ("2.5 RuShang Eight Virtues", "2.5 RuShang Eight Virtues"),  # no-op guard
    ("2.4 RuShang Eight Virtues", "2.5 RuShang Eight Virtues"),
    ("2.4 The Eight Virtues", "2.5 The Eight Virtues"),
    ("2.4 The Ethical Core", "2.5 The Ethical Core"),
    ("Chapter 2.4", "Chapter 2.5"),
    ("2.4 &middot;", "2.5 &middot;"),
    (">2.4</span>", ">2.5</span>"),
    (">2.4</td>", ">2.5</td>"),
    # then 2.3 -> 2.4
    ("2.3 Five Constants", "2.4 Five Constants"),
    ("2.3 The Five Constants", "2.4 The Five Constants"),
    ("Chapter 2.3", "Chapter 2.4"),
    ("2.3 &middot;", "2.4 &middot;"),
    (">2.3</span>", ">2.4</span>"),
    (">2.3</td>", ">2.4</td>"),
]

def apply_repl(s):
    for a, b in SLUG_REPL: s = s.replace(a, b)
    for a, b in DISPLAY_REPL:
        if a != b: s = s.replace(a, b)
    return s

# targets: root html + ch html + data files
targets = [glob.glob(os.path.join(ROOT, "*.html")) +
           glob.glob(os.path.join(ROOT, "ch", "*.html")) +
           [os.path.join(ROOT, "sitemap.xml"), os.path.join(ROOT, "llms.txt"), os.path.join(ROOT, "_redirects")]]
changed = []
for t in targets:
    for p in t:
        s0 = rd(p); s1 = apply_repl(s0)
        if s1 != s0:
            wr(p, s1); changed.append(os.path.relpath(p, ROOT))
LOG.append("slug/display renumber applied to %d files" % len(changed))

# ---------- nav dropdown: insert Mencius after Confucius item ----------
CONF_ITEM = '<a class="nav-dropitem" href="/ch/22confucius" role="menuitem"><span class="nav-dropnum">2.2</span><span class="nav-droplabel">Confucius 551BC Ru-School \u5b54\u5b50 \u5112\u5bb6</span></a>'
MENCIUS_ITEM = '<a class="nav-dropitem" href="/ch/23mencius" role="menuitem"><span class="nav-dropnum">2.3</span><span class="nav-droplabel">Mencius Second Sage \u5b5f\u5b50\u4e9a\u5723</span></a>'
navfiles = 0
for p in glob.glob(os.path.join(ROOT, "*.html")) + glob.glob(os.path.join(ROOT, "ch", "*.html")):
    s = rd(p)
    if CONF_ITEM in s:
        s = s.replace(CONF_ITEM, CONF_ITEM + "\n" + " " * s.count("", 0) + MENCIUS_ITEM, -1) if False else s
        # preserve leading indentation of each occurrence
        out = []
        idx = 0
        cnt = 0
        while True:
            i = s.find(CONF_ITEM, idx)
            if i < 0:
                out.append(s[idx:]); break
            # find line start indentation
            ls = s.rfind("\n", 0, i) + 1
            indent = s[ls:i] if s[ls:i].strip() == "" else ""
            out.append(s[idx:i]); out.append(CONF_ITEM + "\n" + indent + MENCIUS_ITEM)
            idx = i + len(CONF_ITEM); cnt += 1
        wr(p, "".join(out)); navfiles += 1
LOG.append("nav mencius item inserted in %d files" % navfiles)

# ---------- JSON-LD Chapter position bump (+1) for ch pages except 20/21/22 ----------
skip = {"20whatisrudao.html", "21hundredschools.html", "22confucius.html"}
posfiles = 0
for p in glob.glob(os.path.join(ROOT, "ch", "*.html")):
    if os.path.basename(p) in skip: continue
    s = rd(p)
    s2, n = re.subn(r'(?m)^      "position": (\d+),$', lambda m: '      "position": %d,' % (int(m.group(1)) + 1), s)
    if n:
        wr(p, s2); posfiles += 1
LOG.append("chapter position bumped in %d files" % posfiles)

# ---------- sitemap.xml: insert mencius url + lastmod ----------
p = os.path.join(ROOT, "sitemap.xml")
s = rd(p)
newurl = """    <url>
        <loc>https://rudao.org/ch/23mencius</loc>
        <lastmod>2026-11-10</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>
"""
anchor = "    <url>\n        <loc>https://rudao.org/ch/24fiveconstants</loc>"
assert anchor in s, "sitemap anchor missing"
s = s.replace(anchor, newurl + anchor, 1)
# lastmod for the two renamed pages
s = s.replace("""        <loc>https://rudao.org/ch/24fiveconstants</loc>
        <lastmod>2026-11-09</lastmod>""", """        <loc>https://rudao.org/ch/24fiveconstants</loc>
        <lastmod>2026-11-10</lastmod>""")
s = s.replace("""        <loc>https://rudao.org/ch/25eightvirtues</loc>
        <lastmod>2026-11-09</lastmod>""", """        <loc>https://rudao.org/ch/25eightvirtues</loc>
        <lastmod>2026-11-10</lastmod>""")
wr(p, s); LOG.append("sitemap.xml updated")

# ---------- index.html TOC row ----------
p = os.path.join(ROOT, "index.html")
s = rd(p)
i = s.find('<a class="toc-link" href="/ch/24fiveconstants">')
assert i > 0, "index toc anchor missing"
tr = s.rfind('<tr class="toc-row">', 0, i)
ls = s.rfind("\n", 0, tr) + 1
indent = s[ls:tr]
row = ('<tr class="toc-row">\n'
       '                        <td class="toc-cell-num">2.3</td>\n'
       '                        <td class="toc-cell-title">\n'
       '                            <a class="toc-link" href="/ch/23mencius">Mencius Second Sage \u5b5f\u5b50\u4e9a\u5723 - Xing Shan \u6027\u5584\u8bba, Min Ben \u6c11\u672c, She Sheng Qu Yi \u820d\u751f\u53d6\u4e49</a>\n'
       '                        </td>\n'
       '                    </tr>\n')
s = s[:ls] + row + indent + s[tr:] if False else s[:tr] + row + s[tr:]
wr(p, s); LOG.append("index.html TOC row inserted")

# ---------- sitemap.html li ----------
p = os.path.join(ROOT, "sitemap.html")
s = rd(p)
i = s.find('<li><a href="/ch/24fiveconstants">')
assert i > 0, "sitemap.html anchor missing"
ls = s.rfind("\n", 0, i) + 1
indent = s[ls:i]
li = '<li><a href="/ch/23mencius"><span class="sm-num">2.3</span>Mencius Second Sage \u5b5f\u5b50\u4e9a\u5723</a></li>\n'
s = s[:ls] + indent + li + s[ls:]
wr(p, s); LOG.append("sitemap.html li inserted")

# ---------- llms.txt line ----------
p = os.path.join(ROOT, "llms.txt")
s = rd(p)
i = s.find("- 2.4 The Five Constants in Market Competition")
if i < 0: i = s.find("https://rudao.org/ch/24fiveconstants")
assert i > 0, "llms anchor missing"
ls = s.rfind("\n", 0, i) + 1
le = s.find("\n", i) + 1
line = ("- 2.3 Mencius Second Sage \u5b5f\u5b50\u4e9a\u5723 (https://rudao.org/ch/23mencius) - Mencius Meng Ke \u5b5f\u8f72 the Second Sage \u4e9a\u5723: Xing Shan \u6027\u5584\u8bba four moral sprouts \u56db\u7aef, Min Ben \u6c11\u672c \"the people are the most valuable; the state comes next; the ruler is the lightest\", She Sheng Qu Yi \u820d\u751f\u53d6\u4b49, and Jin Xin I \u5c3d\u5fc3\u7ae0\u53e5\u4e0a on seeking within (Qiu Zai Wo Zhe \u5728\u6211\u8005) vs seeking without (Qiu Zai Wai Zhe \u5728\u5916\u8005).\n")
s = s[:ls] + line + s[ls:]
wr(p, s); LOG.append("llms.txt line inserted")

# ---------- _redirects additions ----------
p = os.path.join(ROOT, "_redirects")
s = rd(p)
if "/ch/23fiveconstants" not in s:
    s = s.rstrip("\n") + ("\n/ch/23fiveconstants   /ch/24fiveconstants   301"
                          "\n/ch/24eightvirtues   /ch/25eightvirtues   301"
                          "\n/ch/23/mencius   /ch/23mencius   301\n")
wr(p, s); LOG.append("_redirects updated")

# ---------- create ch/23mencius.html from renamed 24fiveconstants.html ----------
src = os.path.join(ROOT, "ch", "24fiveconstants.html")
dst = os.path.join(ROOT, "ch", "23mencius.html")
s = rd(src)
s = s.replace("24fiveconstants", "23mencius")
s = s.replace("2.4 Five Constants \u4e94\u5e38 - \u4ec1\u4e49\u793c\u667a\u4fe1", "2.3 Mencius Second Sage \u5b5f\u5b50\u4e9a\u5723")
s = s.replace("2.4 The Five Constants as the Ethical Code of Enterprise", "2.3 Mencius Second Sage \u5b5f\u5b50\u4e9a\u5723")
s = s.replace('"name": "The Five Constants as the Ethical Code of Enterprise"', '"name": "Mencius Second Sage \u5b5f\u5b50\u4e9a\u5723"')
s = s.replace('2.4 &middot; Five Constants \u4e94\u5e38 - \u4ec1\u4e49\u793c\u667a\u4fe1', '2.3 &middot; Mencius Second Sage \u5b5f\u5b50\u4e9a\u5723')
s = s.replace("Chapter 2.4", "Chapter 2.3")
s = s.replace('id="ch24"', 'id="ch23"').replace('href="#ch24"', 'href="#ch23"')
s = s.replace("<span>\u5e38</span>", "<span>\u5b5f</span>")
# JSON-LD position back to 10 (copy currently has 11)
s = re.sub(r'(?m)^      "position": 11,$', '      "position": 10,', s, count=1)
# meta / JSON-LD descriptions
DESC = "Mencius (Meng Ke Mengzi, the Second Sage, c. 372-289 BCE): innate goodness Xing Shan and the four sprouts, the people-first Min Ben doctrine, She Sheng Qu Yi righteous integrity, and the Jin Xin I teaching on seeking within versus without - the moral roots of RuDao."
s = re.sub(r'(<meta property="og:description" content=")[^"]*(")', lambda m: m.group(1) + DESC + m.group(2), s, count=1)
s = re.sub(r'(<meta name="twitter:description" content=")[^"]*(")', lambda m: m.group(1) + DESC + m.group(2), s, count=1)
s = re.sub(r'(<meta name="description" content=")[^"]*(")', lambda m: m.group(1) + DESC + m.group(2), s, count=1)
s = re.sub(r'("description": ")[^"]*(")', lambda m: m.group(1) + DESC + m.group(2), s, count=1)

BODY = u'''
        <h3 class="chap-h2">Mencius Second Sage \u5b5f\u5b50\u4e9a\u5723</h3>
        <p>Mencius (Meng Ke \u5b5f\u8f72, also known as Mengzi \u5b5f\u5b50, the Second Sage \u4e9a\u5723, c. 372-289 BCE), a major Confucian philosopher and second only to Confucius (Zhi Sheng \u81f3\u5723) in the early Confucian tradition, was born in the State of Zou (Zou Guo \u90b9\u56fd). He travelled among the warring states to persuade rulers to adopt benevolent governance (Ren Zheng -- \u4ec1\u653f). His recorded dialogues and teachings, collected in the book Mencius (Meng Zi -- \u300a\u5b5f\u5b50\u300b), form a cornerstone of Confucianism and have profoundly shaped Chinese culture and society over two millennia.</p>
        <p><strong>The theory of innate goodness of human nature (Xing Shan \u6027\u5584\u8bba)</strong> Mencius argued that humans are born with four moral sprouts (Si Duan \u56db\u7aef): compassion, shame, respect, and right and wrong. This belief established a cultural baseline: people are educable, moral cultivation is accessible to everyone, and self-improvement is a lifelong duty. It contrasts with rigid fatalism and supports the ideal of moral self-mastery.</p>
        <p><strong>The people-first political doctrine (Min Ben Si Xiang \u6c11\u672c\u601d\u60f3)</strong> His famous maxim -- "the people are the most valuable; the state comes next; the ruler is the lightest" (Min Wei Gui, She Ji Ci Zhi, Jun Wei Qing \u6c11\u4e3a\u8d35\uff0c\u793e\u7a37\u6b21\u4e4b\uff0c\u541b\u4e3a\u8f7b) -- defined the ethical standard for governance. Rulers were expected to care for people's livelihood, reduce heavy taxes, and relieve famine. A tyrant who abandoned benevolence lost his legitimacy; justified resistance against cruel rule became a recognised moral idea. This is not modern democracy, but it planted a lasting check on arbitrary imperial power.</p>
        <p><strong>The ideal of a noble person (Junzi \u541b\u5b50) and righteous integrity (Yi \u4e49)</strong> Mencius elevated the pursuit of righteousness above material gain. His words on preferring death over abandoning virtue (She Sheng Qu Yi \u820d\u751f\u53d6\u4e49) cultivated the archetype of the upright scholar-official, who would not surrender conscience for wealth, rank or pressure. This spirit sustained generations of literati, loyal ministers and patriots.</p>
        <p><strong>Ethics of duty and self-cultivation</strong> His distinction between "seeking what lies within oneself" and "seeking what lies outside oneself" comes from (\u300a\u5b5f\u5b50\u00b7\u5c3d\u5fc3\u7ae0\u53e5\u4e0a\u300b):</p>
        <blockquote class="quote-block">
        <p class="quote">"\u6c42\u5219\u5f97\u4e4b\uff0c\u820d\u5219\u5931\u4e4b\uff0c\u662f\u6c42\u6709\u76ca\u4e8e\u5f97\u4e5f\uff0c\u6c42\u5728\u6211\u8005\u8005\uff1b\u6c42\u4e4b\u6709\u9053\uff0c\u5f97\u4e4b\u6709\u547d\uff0c\u662f\u6c42\u65e0\u76ca\u4e8e\u5f97\u4e5f\uff0c\u6c42\u5728\u5916\u8005\u8005\u3002"<span class="quote-attr"> - Mencius - Jin Xin I \u5b5f\u5b50\u00b7\u5c3d\u5fc3\u7ae0\u53e5\u4e0a</span></p>
        </blockquote>
        <p>"Seek it, and you gain it; abandon it, and you lose it. This seeking bears fruit, for what is sought lies within oneself. There is a proper way to seek something, yet whether you obtain it depends on destiny. This seeking does not guarantee gain, for what is sought lies outside oneself."</p>
        <p>In this passage, Mencius draws a clear boundary: moral nature, virtue and inner resolve belong to "what lies within me (Qiu Zai Wo Zhe \u5728\u6211\u8005)". If I strive to cultivate them, I will attain them; if I neglect them, I will lose them -- this kind of seeking is truly effective. Wealth, status, fame and external rewards belong to "what lies outside me (Qiu Zai Wai Zhe \u5728\u5916\u8005)". I may follow proper principles to pursue them, but the final outcome rests on conditions beyond my control. This outlook shaped the traditional Chinese mindset: focus first on inner moral discipline, maintain inner calm, take responsibility for one's own heart, and accept limits on external outcomes.</p>
        <p><strong>Influence on education, literature and social values</strong> As one of the Four Books (Si Shu \u56db\u4e66), Mencius was the core textbook for imperial civil service examinations (Ke Ju \u79d1\u4e3e) for centuries. Its vocabulary, metaphors and moral logic permeated essays, poetry, family instructions and community norms. It reinforced values such as filial piety (Xiao \u5b5d), kindness to kin, mutual care and communal responsibility.</p>
        <p><strong>Modern resonance</strong> Mencius' ideas on benevolent governance, compassion and human dignity are still widely cited in contemporary Chinese cultural discourse. Together with the thought of Confucius (Kong Zi \u5b54\u5b50), it remains a major source of Chinese cultural identity.
'''

# replace body: between '<div class="preface-body">' and '</section>'
a = s.find('<div class="preface-body">')
assert a > 0
a += len('<div class="preface-body">')
b = s.find('</section>', a)
assert b > a
s = s[:a] + "\n" + BODY + "        " + s[b:]

# pager: next -> 2.4 Five Constants
s = s.replace('<a class="ch-pager-link next" href="/ch/25eightvirtues"><span class="dir">Next \u4e0b\u4e00\u7ae0 &rarr;</span><span class="ttl">2.5 RuShang Eight Virtues \u5112\u5546\u516b\u5fb7</span></a>',
              '<a class="ch-pager-link next" href="/ch/24fiveconstants"><span class="dir">Next \u4e0b\u4e00\u7ae0 &rarr;</span><span class="ttl">2.4 Five Constants \u4e94\u5e38 - \u4ec1\u4e49\u793c\u667a\u4fe1</span></a>')
wr(dst, s); LOG.append("ch/23mencius.html created")

# ---------- pager fixes ----------
# 22confucius: next -> mencius
p = os.path.join(ROOT, "ch", "22confucius.html")
s = rd(p)
s = s.replace('<a class="ch-pager-link next" href="/ch/24fiveconstants"><span class="dir">Next \u4e0b\u4e00\u7ae0 &rarr;</span><span class="ttl">2.4 Five Constants \u4e94\u5e38 - \u4ec1\u4e49\u793c\u667a\u4fe1</span></a>',
              '<a class="ch-pager-link next" href="/ch/23mencius"><span class="dir">Next \u4e0b\u4e00\u7ae0 &rarr;</span><span class="ttl">2.3 Mencius Second Sage \u5b5f\u5b50\u4e9a\u5723</span></a>')
wr(p, s); LOG.append("22confucius next pager -> mencius")

# 24fiveconstants: prev -> mencius
p = os.path.join(ROOT, "ch", "24fiveconstants.html")
s = rd(p)
s = s.replace('<a class="ch-pager-link prev" href="/ch/22confucius"><span class="dir">&larr; Previous \u4e0a\u4e00\u7ae0</span><span class="ttl">2.2 Confucius 551BC Ru-School \u5b54\u5b50 \u5112\u5bb6</span></a>',
              '<a class="ch-pager-link prev" href="/ch/23mencius"><span class="dir">&larr; Previous \u4e0a\u4e00\u7ae0</span><span class="ttl">2.3 Mencius Second Sage \u5b5f\u5b50\u4e9a\u5723</span></a>')
wr(p, s); LOG.append("24fiveconstants prev pager -> mencius")

print("\n".join(LOG))
