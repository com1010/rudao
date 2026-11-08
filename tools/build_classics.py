# -*- coding: utf-8 -*-
"""
Generate the three full-text classic pages for RuDao.org.

  /ch/lunyu      LunYu - The Analects of Confucius (20 books)
  /ch/daodejing  DaoDeJing - Tao Te Ching (81 chapters, Wang Bi received text)
  /ch/artofwar   The Art of War - SunTzu (13 chapters)

Sources (all pre-Qin public-domain classics) live in tools/classics-sources/:
  lunyu.txt             - proofread traditional-character transcription
  daodejing-wangbi.txt  - Chinese Wikisource, 老子道德經注 (Wang Bi edition);
                          only the main text lines are used, the commentary,
                          later prefaces and the collation notes are dropped
  sunzi.txt             - Chinese Wikisource, 孫子兵法; only the 13 chapters,
                          the appended 答話 material is dropped

The pages are static HTML: the text is pasted into the page, nothing is
fetched at runtime. Each chapter is stored twice - traditional (原文) and
simplified (简体) - and js/classics.js switches between them. zhconv is only
needed when this script is re-run; the generated pages have no dependency.

Run:  python tools/build_classics.py
"""
from __future__ import annotations

import html
import re
from pathlib import Path

import zhconv

from site_data import ROOT, CACHE, font_tags, head_link_tags, full_nav, tail_scripts

SRC = ROOT / "tools" / "classics-sources"
CJK = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF]")


def cjk_count(text: str) -> int:
    return len(CJK.findall(text))


def simp(text: str) -> str:
    # zhconv also swaps corner brackets for curly double quotes; keep the
    # classical corner brackets and avoid curly quotes entirely (site rule).
    return (zhconv.convert(text, "zh-cn")
            .replace("\u201c", "\u300c").replace("\u201d", "\u300d")
            .replace("\u2018", "\u300e").replace("\u2019", "\u300f"))


def clean_wiki(line: str) -> str:
    """Remove the few MediaWiki artefacts that appear in the main text."""
    line = re.sub(r"\{\{另\|([^|}]*)\|[^}]*\}\}", r"\1", line)   # variant reading
    line = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", line)       # piped link
    line = re.sub(r"\[\[([^\]]*)\]\]", r"\1", line)                # plain link
    line = line.replace("-{", "").replace("}-", "")                # conversion flag
    line = re.sub(r"\{[宀尒][^}]*\}", "", line)                     # rare glyph description
    return line.strip()


def split_sentences(text: str) -> list[str]:
    """Break a joined DaoDeJing chapter into short readable lines."""
    parts = re.findall(r"[^。！？]*[。！？]+|[^。！？]+$", text)
    out, buf = [], ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if len(buf) + len(p) < 34:
            buf += p
        else:
            if buf:
                out.append(buf)
            buf = p
    if buf:
        out.append(buf)
    return out


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------
LUNYU_EN = [
    "Book 1 - To Learn and Practise", "Book 2 - On Government", "Book 3 - Ritual and the Eight Dancers",
    "Book 4 - Living Among the Ren", "Book 5 - Gongye Chang and Judging Character",
    "Book 6 - Yong Ye and the Disciples", "Book 7 - The Master's Own Way", "Book 8 - Tai Bo and the Ancient Worthies",
    "Book 9 - Zi Han and the Master's Character", "Book 10 - Xiang Dang: Daily Conduct and Li",
    "Book 11 - Disciples Old and New", "Book 12 - Yan Yuan on Ren and Self-Restraint",
    "Book 13 - Zi Lu on Governance", "Book 14 - Xian Wen: Questions on Conduct",
    "Book 15 - Duke Ling of Wei: Principles in Adversity", "Book 16 - The Ji Family and Order in the State",
    "Book 17 - Yang Huo and Human Nature", "Book 18 - Wei Zi: Withdrawing from the World",
    "Book 19 - Zi Zhang: Sayings of the Disciples", "Book 20 - Yao Yue: The Ancient Kings",
]

SUNZI_EN = [
    "Chapter 1 - Laying Plans", "Chapter 2 - Waging War", "Chapter 3 - Attack by Stratagem",
    "Chapter 4 - Tactical Dispositions", "Chapter 5 - Energy", "Chapter 6 - Weak Points and Strong",
    "Chapter 7 - Manoeuvring", "Chapter 8 - Variation in Tactics", "Chapter 9 - The Army on the March",
    "Chapter 10 - Terrain", "Chapter 11 - The Nine Situations", "Chapter 12 - The Attack by Fire",
    "Chapter 13 - The Use of Spies",
]


def parse_lunyu() -> list[dict]:
    chapters, cur = [], None
    for raw in (SRC / "lunyu.txt").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        m = re.match(r"^##\s+(.+篇第[一二三四五六七八九十]+)\s*$", line)
        if m:
            cur = {"title": m.group(1), "paras": []}
            chapters.append(cur)
            continue
        if line.startswith("#") or not line or cur is None:
            continue
        cur["paras"].append(line)
    assert len(chapters) == 20, len(chapters)
    return chapters


def parse_daodejing() -> list[dict]:
    chapters, cur = [], None
    for raw in (SRC / "daodejing-wangbi.txt").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("="):
            m = re.match(r"^==\s*([一二三四五六七八九十百]+章)\s*==$", line)
            if m:
                cur = {"title": m.group(1), "paras": []}
                chapters.append(cur)
            continue
        # Commentary lines, templates and the appended Song-dynasty prefaces.
        if line.startswith(":") or line.startswith("{{") or line.startswith("|"):
            continue
        if line.startswith("王弼老子道德經二卷"):
            cur = None                     # everything after this is apparatus
            continue
        if cur is None or not CJK.search(line):
            continue
        cur["paras"].append(clean_wiki(line))
    assert len(chapters) == 81, len(chapters)
    out = []
    for i, ch in enumerate(chapters, 1):
        joined = "".join(ch["paras"])
        out.append({
            "title": "第%s章" % cn_num(i),
            "paras": split_sentences(clean_wiki(joined)),
        })
    return out


CN_DIGITS = "零一二三四五六七八九"


def cn_num(n: int) -> str:
    if n < 10:
        return CN_DIGITS[n]
    if n == 10:
        return "十"
    if n < 20:
        return "十" + CN_DIGITS[n - 10]
    return CN_DIGITS[n // 10] + "十" + (CN_DIGITS[n % 10] if n % 10 else "")


def parse_sunzi() -> list[dict]:
    chapters, cur = [], None
    for raw in (SRC / "sunzi.txt").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("== "):
            if "答話" in line:
                break                     # later Q&A appendix, not the 13 chapters
            m = re.match(r"^==\s*(.+第[一二三四五六七八九十]+)\s*==$", line)
            if m:
                cur = {"title": m.group(1), "paras": []}
                chapters.append(cur)
            continue
        if not line or line.startswith("{{") or line.startswith("|"):
            continue
        # A line may *begin* with a wiki link but still be main text, e.g.
        # [[wikipedia:zh:孙武|孫子]]曰：兵者 ... - the opening of chapter 1.
        # Only skip pure category / navigation link lines.
        if line.startswith("[[") and line.endswith("]]") and "|" not in line:
            continue
        if cur is not None:
            cur["paras"].append(clean_wiki(line))
    assert len(chapters) == 13, len(chapters)
    return chapters


# ---------------------------------------------------------------------------
# Page metadata
# ---------------------------------------------------------------------------
PAGES = [
    {
        "slug": "lunyu",
        "h1_en": "LunYu",
        "h1_cn": "论语",
        "sub": "The Analects of Confucius",
        "kicker": "The Chinese classics 典籍原文 &middot; 1 of 3",
        "lead": "The full original Chinese text of the LunYu in twenty books, the record of Confucius and his disciples that opens the Ru tradition. Read it here in simplified or original characters, with a short English label for every book.",
        "lead_cn": "《论语》二十篇全文。孔子与弟子言行录,儒家之根本。可切换简体与繁體原文,每篇附英文题名。",
        "units": "20 books 二十篇",
        "desc": "Full original Chinese text of the LunYu (The Analects of Confucius), all 20 books, about 15,900 characters, in simplified and traditional characters with English book titles.",
        "keywords": "Lunyu, 论语, 論語, Analects of Confucius, 论语全文, 論語全文, 20 books, Chinese classic full text, Confucius, RuDao",
        "chapters": parse_lunyu(),
        "english": LUNYU_EN,
        "source_label": "proofread traditional-character transcription (chtxt)",
        "source_url": "https://github.com/zuiaijichu/chtxt",
        "source_note": "Base text: a proofread transcription of the twenty-book received LunYu. Simplified characters are a mechanical conversion; the original-character view is the source reading.",
        "toc_group": None,
    },
    {
        "slug": "daodejing",
        "h1_en": "DaoDeJing",
        "h1_cn": "道德经",
        "sub": "Tao Te Ching - LaoZi - the Five Thousand Characters 五千言",
        "kicker": "The Chinese classics 典籍原文 &middot; 2 of 3",
        "lead": "All eighty-one chapters of the DaoDeJing, the Wang Bi received text, in the original Chinese. Chapters 1-37 are the Dao Jing 道经 and 38-81 the De Jing 德经 - the book RuDao draws on for 上善若水 and 反者道之动.",
        "lead_cn": "《道德经》王弼本八十一章全文。前三十七章为道经,后四十四章为德经。五千言,可切换简体与繁體原文。",
        "units": "81 chapters 八十一章",
        "desc": "Full original Chinese text of the DaoDeJing (Tao Te Ching), all 81 chapters of the Wang Bi received text, about 5,200 characters 五千言, in simplified and traditional characters.",
        "keywords": "DaoDeJing, 道德经, 道德經, Tao Te Ching, LaoZi, 老子, 五千言, 道德经全文, 81 chapters, Wang Bi, Chinese classic full text",
        "chapters": parse_daodejing(),
        "english": ["Chapter %d%s" % (i, " - Dao Jing 道经" if i <= 37 else " - De Jing 德经") for i in range(1, 82)],
        "source_label": "Chinese Wikisource - 老子道德經注 (Wang Bi edition)",
        "source_url": "https://zh.wikisource.org/wiki/%E9%81%93%E5%BE%B7%E7%B6%93_(%E7%8E%8B%E5%BC%BC%E6%9C%AC)",
        "source_note": "Only the main text of each chapter is reproduced; Wang Bi's commentary, the宋人序跋 and the collation notes are omitted. The received text divides into the Dao Jing 道经 (1-37) and De Jing 德经 (38-81).",
        "toc_group": 37,
    },
    {
        "slug": "artofwar",
        "h1_en": "The Art of War",
        "h1_cn": "孙子兵法",
        "sub": "SunTzu - the thirteen chapters",
        "kicker": "The Chinese classics 典籍原文 &middot; 3 of 3",
        "lead": "The complete original Chinese text of SunTzu's thirteen chapters, from 始计 to 用间. RuDao takes its title from this book and argues that business needs co-opetition 竞合 rather than a zero-sum campaign - read the source here before you read the argument.",
        "lead_cn": "《孙子兵法》十三篇全文,自《始计》至《用间》。先读原文,再读《儒道》如何超越零和。",
        "units": "13 chapters 十三篇",
        "desc": "Full original Chinese text of The Art of War (孙子兵法) by SunTzu, all 13 chapters, about 6,000 characters, in simplified and traditional characters with English chapter titles.",
        "keywords": "The Art of War, 孙子兵法, 孫子兵法, SunTzu, Sun Tzu, 孙子兵法全文, 13 chapters, Chinese classic full text, RuDao, co-opetition",
        "chapters": parse_sunzi(),
        "english": SUNZI_EN,
        "source_label": "Chinese Wikisource - 孫子兵法",
        "source_url": "https://zh.wikisource.org/wiki/%E5%AD%AB%E5%AD%90%E5%85%B5%E6%B3%95",
        "source_note": "The thirteen chapters only; the 答話 appendix of later questions and answers is not part of the received thirteen-chapter text.",
        "toc_group": None,
    },
]


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def esc_attr(s: str) -> str:
    return html.escape(s, quote=True)


def cross_links(slug: str) -> str:
    labels = {"lunyu": "LunYu 论语", "daodejing": "DaoDeJing 道德经", "artofwar": "Art of War 孙子兵法"}
    out = []
    for key, label in labels.items():
        if key == slug:
            out.append('<span class="cl-chip is-here">%s</span>' % label)
        else:
            out.append('<a class="cl-chip" href="/ch/%s">%s</a>' % (key, label))
    out.append('<a class="cl-chip" href="/sitemap">Site Map 网站地图</a>')
    out.append('<a class="cl-chip" href="/">RuDao 儒道 &larr;</a>')
    return "\n".join(out)


def ld_json(p: dict, count: int) -> str:
    import json
    data = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebPage",
                "@id": "https://rudao.org/ch/%s#webpage" % p["slug"],
                "url": "https://rudao.org/ch/%s" % p["slug"],
                "name": "%s %s - full original Chinese text | RuDao" % (p["h1_en"], p["h1_cn"]),
                "description": p["desc"],
                "inLanguage": ["zh", "en"],
                "isPartOf": {"@type": "WebSite", "name": "RuDao", "url": "https://rudao.org/"},
                "about": [p["h1_en"], p["h1_cn"], "Chinese classics", "original text"],
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "RuDao 儒道", "item": "https://rudao.org/"},
                    {"@type": "ListItem", "position": 2, "name": "The Chinese classics 典籍原文", "item": "https://rudao.org/sitemap#classics"},
                    {"@type": "ListItem", "position": 3, "name": p["h1_en"], "item": "https://rudao.org/ch/%s" % p["slug"]},
                ],
            },
        ],
    }
    return json.dumps(data, ensure_ascii=False, indent=2)


def render(p: dict) -> str:
    chs = p["chapters"]
    total = sum(cjk_count("".join(ch["paras"])) for ch in chs)
    head = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{h1_en} {h1_cn} - Full Original Chinese Text | RuDao 儒道</title>
<meta name="description" content="{desc}" />
<meta name="keywords" content="{keywords}" />
<meta name="author" content="Tony Tong (唐仪) - https://TonyTong.cc" />
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" />
<link rel="canonical" href="https://rudao.org/ch/{slug}" />
<link rel="alternate" href="https://rudao.org/ch/{slug}" hreflang="en" />
<link rel="alternate" href="https://rudao.org/ch/{slug}" hreflang="zh-Hans" />
<link rel="alternate" href="https://rudao.org/ch/{slug}" hreflang="x-default" />
<link rel="author" href="https://TonyTong.cc" />
<meta property="og:type" content="article" />
<meta property="og:title" content="{h1_en} {h1_cn} - Full Original Chinese Text | RuDao" />
<meta property="og:description" content="{desc}" />
<meta property="og:url" content="https://rudao.org/ch/{slug}" />
<meta property="og:image" content="https://rudao.org/assets/rudao-cover-primary.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{h1_en} {h1_cn} - full Chinese text | RuDao" />
<meta name="twitter:description" content="{desc}" />
{fonts}
{links}
<script type="application/ld+json">
{ld}
</script>
</head>
<body class="cl-body" data-nav-dropdowns="generic">
""".format(h1_en=esc(p["h1_en"]), h1_cn=esc(p["h1_cn"]), desc=esc(p["desc"]),
           keywords=esc(p["keywords"]), slug=p["slug"], fonts=font_tags(),
           links=head_link_tags(), ld=ld_json(p, total))

    hero = """{nav}
<main class="cl-main">
<section class="cl-hero">
  <div class="container cl-wrap">
    <p class="cl-kicker">{kicker}</p>
    <h1 class="cl-h1"><span class="cl-h1-en">{h1_en}</span> <span class="zh">{h1_cn}</span></h1>
    <p class="cl-sub">{sub}</p>
    <p class="cl-lead">{lead}</p>
    <p class="cl-lead-cn">{lead_cn}</p>
    <p class="cl-stats"><span>{units}</span><span>{total:,} Chinese characters 字</span><span>Original + Simplified 繁體 / 简体</span></p>
    <div class="cl-chips">{chips}</div>
    <div class="cl-switch" role="group" aria-label="Character variant">
      <span class="cl-switch-label">Characters 字形</span>
      <button type="button" class="cl-switch-btn is-on" data-variant="s" aria-pressed="true">简体 Simplified</button>
      <button type="button" class="cl-switch-btn" data-variant="t" aria-pressed="false">繁體 Original</button>
      <span class="cl-switch-note">The same full text in both forms - nothing is translated away.</span>
    </div>
  </div>
</section>
""".format(nav=full_nav(), kicker=p["kicker"], h1_en=esc(p["h1_en"]), h1_cn=esc(p["h1_cn"]),
           sub=esc(p["sub"]), lead=esc(p["lead"]), lead_cn=esc(p["lead_cn"]),
           units=esc(p["units"]), total=total, chips=cross_links(p["slug"]))

    # table of contents
    toc = ['<section class="cl-toc" id="contents">', '  <div class="container cl-wrap">',
           '    <h2 class="cl-h2">Contents 目录</h2>',
           '    <p class="cl-toc-note">Jump to any chapter. Every chapter shows the complete original text, not an excerpt.</p>',
           '    <ol class="cl-toc-grid">']
    if p["toc_group"]:
        toc.append('      <li class="cl-toc-group">Dao Jing 道经 &middot; chapters 1-37</li>')
    for i, ch in enumerate(chs):
        if p["toc_group"] and i == p["toc_group"]:
            toc.append('      <li class="cl-toc-group">De Jing 德经 &middot; chapters 38-81</li>')
        label = p["english"][i]
        toc.append(
            '      <li><a href="#c%d"><span class="cl-toc-num">%02d</span><span class="cl-toc-cn"><span class="zh">%s</span></span><span class="cl-toc-en">%s</span></a></li>'
            % (i + 1, i + 1, esc(simp(ch["title"])), esc(label))
        )
    toc += ['    </ol>', '  </div>', '</section>']

    # full text
    body = ['<section class="cl-text" id="fulltext">', '  <div class="container cl-wrap">',
            '    <h2 class="cl-h2">Full original Chinese text 全文</h2>']
    for i, ch in enumerate(chs):
        label = p["english"][i]
        body.append('    <article class="cl-chapter" id="c%d">' % (i + 1))
        body.append('      <header class="cl-ch-head"><span class="cl-ch-num">%02d</span><h3><span class="cl-ch-cn"><span class="zh">%s</span></span><span class="cl-ch-en">%s</span></h3></header>' % (i + 1, esc(simp(ch["title"])), esc(label)))
        body.append('      <div class="cl-variants">')
        for variant, ch_title, paras in (
            ("s", simp(ch["title"]), [simp(x) for x in ch["paras"]]),
            ("t", ch["title"], ch["paras"]),
        ):
            body.append('        <div class="cl-v" data-variant="%s" data-title="%s">' % (variant, esc_attr(ch_title)))
            for para in paras:
                body.append('          <p>%s</p>' % esc(para))
            body.append('        </div>')
        body += ['      </div>', '    </article>']

    end = ['  </div>', '</section>',
           '<section class="cl-end">', '  <div class="container cl-wrap">',
           '    <h2 class="cl-h2">About this text 版本说明</h2>',
           '    <p class="cl-end-p">%s</p>' % esc(p["source_note"]),
           '    <p class="cl-end-p">Source: <a href="%s" target="_blank" rel="noopener noreferrer">%s</a>. The original work is a pre-Qin classic in the public domain; this page reproduces the Chinese text for reading and study alongside <em>RuDao</em>. The simplified view is a character conversion of the same text.</p>' % (p["source_url"], esc(p["source_label"])),
           '    <p class="cl-end-p cl-end-links"><a href="/">Read RuDao 儒道 &rarr;</a> &nbsp;&middot;&nbsp; <a href="/sitemap">Full Site Map 网站地图 &rarr;</a> &nbsp;&middot;&nbsp; <a href="#contents">Back to contents &uarr;</a></p>',
           '  </div>', '</section>', '</main>',
           '<footer class="cl-foot"><div class="container cl-wrap">',
           '  <p>RuDao 儒道 - Beyond The Art of War. A bilingual book by Tony Tong 唐仪. &copy; 2026 <a href="https://TonyTong.cc">TonyTong.cc</a>. Classical Chinese texts are in the public domain.</p>',
           '</div></footer>',
           tail_scripts(), '</body>', '</html>', '']

    return head + hero + "\n".join(toc) + "\n" + "\n".join(body) + "\n" + "\n".join(end)


def main() -> None:
    for p in PAGES:
        total = sum(cjk_count("".join(ch["paras"])) for ch in p["chapters"])
        path = ROOT / "ch" / (p["slug"] + ".html")
        path.write_text(render(p), encoding="utf-8", newline="\n")
        print("%-12s %2d chapters  %6d CJK chars  %7d bytes  -> %s" %
              (p["slug"], len(p["chapters"]), total, path.stat().st_size, path.name))


if __name__ == "__main__":
    main()
