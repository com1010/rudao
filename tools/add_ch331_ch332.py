# -*- coding: utf-8 -*-
"""
One-time split: chapter 3.3 becomes an overview page and the two stories
get their own sub-chapter pages:

    /ch/33daoismstories  3.3   Daoism Stories: SaiWeng & LiaoFan's Lessons
    /ch/331saiweng       3.3.1 SaiWeng's Lost Horse        塞翁失马
    /ch/332liaofan       3.3.2 LiaoFan's Four Lessons       了凡四训

Chapter chain: 3.2 -> 3.3 -> 3.3.1 -> 3.3.2 -> 4.0
Run from the repo root:  python tools/add_ch331_ch332.py
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMPL = os.path.join(ROOT, "ch", "33daoismstories.html")


def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)


# ---------------------------------------------------------------- template
tpl = read(TMPL)
i1 = tpl.index('<section class="section preface chap-sec" id="ch33">')
i2 = tpl.index('<nav class="ch-pager"')
HEAD = tpl[:i1]          # doctype, head, nav, breadcrumb
FOOT = tpl[i2:]          # pager, footer, scripts

CH33_TITLE = "3.3 Daoism Stories: SaiWeng &amp; LiaoFan's Lessons 塞翁失馬 了凡四训 | RuDao 儒道"
CH331_TITLE = "3.3.1 SaiWeng's Lost Horse 塞翁失马 | RuDao 儒道"
CH332_TITLE = "3.3.2 LiaoFan's Four Lessons 了凡四训 | RuDao 儒道"

CH331_BODY = '''        <section class="section preface chap-sec" id="ch331">
                <div class="chapter-band" aria-hidden="true"></div>
                <div class="container preface-container">
                    <div class="section-head preface-head">
                        <span class="section-num">Chapter 3.3.1</span>
                        <h2 class="section-title">SaiWeng's Lost Horse<a class="section-anchor" href="#ch331" aria-label="Copy link to this chapter">#</a></h2>
                        <p class="section-title-cn">塞翁失马</p>
                    </div>
                    <div class="preface-divider" aria-hidden="true"><span>道</span></div>
                    <div class="preface-body">
        <h3 class="chap-h2">The Story from the Huainanzi</h3>
        <p>This old tale comes from the <em>Huainanzi</em> (《淮南子》), an important early book of Taoist thinking. It has been told for more than two thousand years, and it is the story people reach for whenever luck seems to flip without warning.</p>
        <p>An old man who lived near the border lost one of his horses. His neighbors came over to feel bad for him. The old man just said calmly: "How do we know this isn't actually good luck?"</p>
        <p>A little while later, the missing horse came back. It brought a strong, beautiful wild horse along with it. The neighbors showed up to celebrate with him. Again, the old man gave a quiet warning: "How do we know this won't turn into trouble?"</p>
        <p>His son decided to ride the new horse. He fell off and broke his leg. The neighbors came once more to comfort the family. Soon after that, war started. Nearly all the healthy young men from that area got drafted, and many never came home. Because of his broken leg, the old man's son was spared from fighting.</p>
        <h3 class="chap-h2">The Lesson: Fortune and Misfortune Keep Trading Places</h3>
        <p>The lesson is simple but powerful: <strong>Something that looks like good news today might bring trouble later. Something that feels like bad news right now might open up a blessing you cannot yet see.</strong></p>
        <p>SaiWeng's story reminds us we only see a small slice of what is happening. Events fit into bigger patterns we usually cannot make out.</p>
        <h3 class="chap-h2">This Is Not Fatalism</h3>
        <p>This is NOT the idea that everything is fixed ahead of time (fatalism). It is a Taoist way of seeing: good and bad luck are linked, and they can flip into each other.</p>
        <p>LaoZi wrote the same idea in DaoDeJing:</p>
        <blockquote class="quote-block">
        <p class="quote">"Misfortune is that upon which fortune depends; Fortune is that within which misfortune hides." 祸兮福之所倚,福兮祸之所伏。<span class="quote-attr"> - LaoZi, <em>DaoDeJing</em> (道德经)</span></p>
        </blockquote>
        <p>Where the story gives us pictures, LaoZi's line gives us the principle: fortune and misfortune lean on each other, follow each other, and hide inside each other. SaiWeng's calm "How do we know?" is simply this principle spoken by a farmer at the border.</p>
        <div class="chapter-end-frame" aria-label="Chapter Review and Bridge to next chapter">
        <p class="frame-label">Chapter Review</p>
        <p class="frame-lede">A lost horse returns with a wild horse; a broken leg spares a son from war. Four turns of fortune, and the old man never once declares the ending.</p>
        <p class="frame-text">SaiWeng ShiMa teaches the Taoist wisdom of how things shift: good and bad luck are linked and can flip into each other, so we hold every event loosely. This is not fatalism - it is the humility to admit we only see a small slice of the pattern.</p>
        <hr class="frame-rule" />
        <p class="frame-label">Bridge to next chapter</p>
        <p class="frame-text">Staying calm while luck flips is half of the Taoist answer. The other half is what you do inside the uncertainty - that is the lesson of Yuan Liao-Fan. (Chapter 3.3.2)</p>
        </div>
                    </div>
                </div>
            </section>

'''

CH332_BODY = '''        <section class="section preface chap-sec" id="ch332">
                <div class="chapter-band" aria-hidden="true"></div>
                <div class="container preface-container">
                    <div class="section-head preface-head">
                        <span class="section-num">Chapter 3.3.2</span>
                        <h2 class="section-title">LiaoFan's Four Lessons<a class="section-anchor" href="#ch332" aria-label="Copy link to this chapter">#</a></h2>
                        <p class="section-title-cn">了凡四训</p>
                    </div>
                    <div class="preface-divider" aria-hidden="true"><span>道</span></div>
                    <div class="preface-body">
        <h3 class="chap-h2">The Story of Yuan Huang</h3>
        <p>SaiWeng teaches us to stay calm when life is uncertain. Liao-Fan's Four Lessons (《了凡四训》) teaches us to take responsibility inside that uncertainty.</p>
        <p>Yuan Huang (袁黄, called Yuan Liao-Fan) wrote this book during China's Ming Dynasty. His writing connects three traditions: Confucian self-improvement, Buddhist ideas of cause and effect, and Taoist discipline and guiding your own life.</p>
        <p>When Yuan was young, a fortune-teller laid out his whole future in exact detail: what ranks he would earn on his exams, how much he would make as an official, how long he would live, and that he would never have a son.</p>
        <p>Year after year, every prediction came true. Yuan believed his future was completely set. He stopped trying and just accepted whatever fate handed him.</p>
        <h3 class="chap-h2">Master YunGu's Challenge</h3>
        <p>Everything changed when he met Master YunGu (云谷禅师). The monk challenged Yuan's mindset with one short, life-changing saying:</p>
        <blockquote class="quote-block">
        <p class="quote">"Destiny is created by oneself. Blessings are sought by oneself." 命由我作,福自己求。<span class="quote-attr"> - Master YunGu, <em>Liao-Fan's Four Lessons</em> (了凡四训)</span></p>
        </blockquote>
        <h3 class="chap-h2">The Four Lessons</h3>
        <p>Yuan woke up to this truth. He started working hard to live a better, more honest life, and kept a daily log of his good acts and his mistakes. His teachings were later organized into four parts:</p>
        <ol>
        <li><strong>The Study of Establishing One's Destiny 立命之学</strong> - People are not trapped by a fate written for them. Consistent moral effort can change the direction of your life.</li>
        <li><strong>The Method of Correcting Faults 改过之法</strong> - Honestly checking yourself and fixing your mistakes is the first step to growing.</li>
        <li><strong>The Way of Accumulating Good Deeds 积善之方</strong> - Virtue grows from steady, small choices to help others and act responsibly.</li>
        <li><strong>The Efficacy of Humility 谦德之效</strong> - Humility keeps you wise, draws people toward you, and stops success from turning you arrogant and careless.</li>
        </ol>
        <p>Over many years of steady practice, Yuan outran the fate the fortune-teller had laid out. He had a son, and lived far longer than he was told he would. You can read this story as literal or symbolic. Either way, the main point stays the same: <strong>Your character changes your fate.</strong></p>
        <div class="chapter-end-frame" aria-label="Chapter Review and Bridge to next chapter">
        <p class="frame-label">Chapter Review</p>
        <p class="frame-lede">A fortune-teller called every turn of Yuan Huang's early life; Master YunGu called the turn that mattered: 命由我作,福自己求 - destiny is created by oneself, blessings are sought by oneself.</p>
        <p class="frame-text">Liao-Fan's Four Lessons - establishing destiny 立命之学, correcting faults 改过之法, accumulating good deeds 积善之方, and humility 谦德之效 - turn SaiWeng's wise acceptance into active responsibility. Inside a shifting world, your choices, intentions, self-control, and humility still make a real difference.</p>
        <hr class="frame-rule" />
        <p class="frame-label">Bridge to next chapter</p>
        <p class="frame-text">Inner cultivation now meets its hardest test: the contest. On the battlefield, SunTzu discovered the outer limits of the RuDao system. (Chapter 4)</p>
        </div>
                    </div>
                </div>
            </section>

'''


def swap_meta(s, url, title, desc, crumb_here, ch_name, ch_headline, ch_pos):
    s = s.replace("ch/33daoismstories", "ch/" + url)
    s = s.replace("<title>3.3 Daoism Stories 儒道四训 | RuDao 儒道</title>", "<title>" + title + "</title>")
    s = s.replace('<meta property="og:title" content="3.3 Daoism Stories 儒道四训 | RuDao 儒道" />',
                  '<meta property="og:title" content="' + title + '" />')
    s = re.sub(r'<meta name="description" content="[^"]*" />',
               '<meta name="description" content="' + desc + '" />', s, count=1)
    s = re.sub(r'<meta property="og:description" content="[^"]*" />',
               '<meta property="og:description" content="' + desc + '" />', s, count=1)
    s = s.replace('<span class="here">3.3 &middot; Daoism Stories 儒道四训</span>',
                  '<span class="here">' + crumb_here + '</span>')
    s = s.replace('"name": "3.3 Daoism Stories 儒道四训",\n          "item": "https://rudao.org/ch/' + url + '"',
                  '"name": "' + crumb_here.replace(" &middot; ", " &middot; ") + '",\n          "item": "https://rudao.org/ch/' + url + '"')
    s = s.replace('"name": "Daoism Stories: SaiWeng & Liao-Fan\'s Four Lessons",\n      "headline": "3.3 Daoism Stories: SaiWeng & Liao-Fan\'s Four Lessons",',
                  '"name": "' + ch_name + '",\n      "headline": "' + ch_headline + '",')
    s = s.replace('"position": 15,', '"position": ' + str(ch_pos) + ',')
    return s


def swap_pager(s, prev_href, prev_ttl, next_href, next_ttl):
    s = re.sub(r'<a class="ch-pager-link prev" href="[^"]*"><span class="dir">&larr; Previous 上一章</span><span class="ttl">[^<]*</span></a>',
               '<a class="ch-pager-link prev" href="' + prev_href + '"><span class="dir">&larr; Previous 上一章</span><span class="ttl">' + prev_ttl + '</span></a>', s)
    s = re.sub(r'<a class="ch-pager-link next" href="[^"]*"><span class="dir">Next 下一章 &rarr;</span><span class="ttl">[^<]*</span></a>',
               '<a class="ch-pager-link next" href="' + next_href + '"><span class="dir">Next 下一章 &rarr;</span><span class="ttl">' + next_ttl + '</span></a>', s)
    return s


# ---------------------------------------------------------------- 3.3.1
p331 = swap_meta(HEAD, "331saiweng", CH331_TITLE,
    "An old man loses a horse, gains two, breaks a leg, and is spared from war. The Taoist tale of SaiWeng ShiMa from the Huainanzi: fortune and misfortune keep trading places.",
    "3.3.1 &middot; SaiWeng's Lost Horse 塞翁失马",
    "SaiWeng's Lost Horse 塞翁失马", "3.3.1 SaiWeng's Lost Horse", 16)
p331 += CH331_BODY
p331 += swap_pager(FOOT, "/ch/33daoismstories", "3.3 Daoism Stories: SaiWeng &amp; LiaoFan's Lessons",
                         "/ch/332liaofan", "3.3.2 LiaoFan's Four Lessons 了凡四训")
write(os.path.join(ROOT, "ch", "331saiweng.html"), p331)

# ---------------------------------------------------------------- 3.3.2
p332 = swap_meta(HEAD, "332liaofan", CH332_TITLE,
    "A fortune-teller called every turn of Yuan Huang's life - until Master YunGu said: destiny is created by oneself. The four lessons of LiaoFan's Four Lessons: your character changes your fate.",
    "3.3.2 &middot; LiaoFan's Four Lessons 了凡四训",
    "LiaoFan's Four Lessons 了凡四训", "3.3.2 LiaoFan's Four Lessons", 17)
p332 += CH332_BODY
p332 += swap_pager(FOOT, "/ch/331saiweng", "3.3.1 SaiWeng's Lost Horse 塞翁失马",
                         "/ch/40ruvsstrategists", "4.0 Ru vs Strategists 儒家-兵家-竞合之道")
write(os.path.join(ROOT, "ch", "332liaofan.html"), p332)

# ---------------------------------------------------------------- 3.3 overview
cur = read(TMPL)

# head/meta: new title + cn subtitle
cur = cur.replace("<title>3.3 Daoism Stories 儒道四训 | RuDao 儒道</title>", "<title>" + CH33_TITLE + "</title>")
cur = cur.replace('<meta property="og:title" content="3.3 Daoism Stories 儒道四训 | RuDao 儒道" />',
                  '<meta property="og:title" content="' + CH33_TITLE + '" />')
cur = cur.replace('<span class="here">3.3 &middot; Daoism Stories 儒道四训</span>',
                  '<span class="here">3.3 &middot; Daoism Stories: SaiWeng &amp; LiaoFan\'s Lessons 塞翁失馬 了凡四训</span>')
cur = cur.replace('"name": "3.3 Daoism Stories 儒道四训",\n          "item": "https://rudao.org/ch/33daoismstories"',
                  '"name": "3.3 Daoism Stories: SaiWeng &amp; LiaoFan\'s Lessons 塞翁失馬 了凡四训",\n          "item": "https://rudao.org/ch/33daoismstories"')
cur = cur.replace('"name": "Daoism Stories: SaiWeng & Liao-Fan\'s Four Lessons",\n      "headline": "3.3 Daoism Stories: SaiWeng & Liao-Fan\'s Four Lessons",',
                  '"name": "Daoism Stories: SaiWeng &amp; LiaoFan\'s Lessons 塞翁失馬 了凡四训",\n      "headline": "3.3 Daoism Stories: SaiWeng &amp; LiaoFan\'s Lessons 塞翁失馬 了凡四训",')

# section head: new title + cn
cur = cur.replace('<h2 class="section-title">Daoism Stories: SaiWeng &amp; Liao-Fan\'s Four Lessons<a class="section-anchor"',
                  '<h2 class="section-title">Daoism Stories: SaiWeng &amp; LiaoFan\'s Lessons<a class="section-anchor"')
cur = cur.replace('<p class="section-title-cn">儒道四训</p>', '<p class="section-title-cn">塞翁失馬 了凡四训</p>')

# replace the two story h4 sections with pointers to the new sub-pages
cur = re.sub(
    r'<h4 class="chap-h3">SaiWeng ShiMa: The Taoist Wisdom of How Things Shift</h4>\n.*?<h4 class="chap-h3">Liao-Fan\'s Four Lessons',
    '''<h4 class="chap-h3">SaiWeng ShiMa: The Taoist Wisdom of How Things Shift</h4>
        <p>This old tale comes from the <em>Huainanzi</em> (《淮南子》), an important early book of Taoist thinking. A border farmer loses a horse, gains two, breaks a leg, and is spared from war - four turns of fortune, each one flipping the meaning of the last. The old man never celebrates and never grieves; he only asks: "How do we know?"</p>
        <p>The full story, and the Taoist principle behind it, has its own chapter: <a href="/ch/331saiweng">Chapter 3.3.1 SaiWeng's Lost Horse 塞翁失马</a>.</p>
        <h4 class="chap-h3">Liao-Fan's Four Lessons''',
    cur, flags=re.S)

cur = re.sub(
    r'<h4 class="chap-h3">Liao-Fan\'s Four Lessons: You Can Shape Your Fate Through Self-Improvement</h4>\n.*?<h4 class="chap-h3">The RuDao Distinction</h4>',
    '''<h4 class="chap-h3">Liao-Fan's Four Lessons: You Can Shape Your Fate Through Self-Improvement</h4>
        <p>A fortune-teller in the Ming Dynasty called every detail of young Yuan Huang's life - and every prediction came true, until Yuan met Master YunGu and heard the line that changed him: "Destiny is created by oneself. Blessings are sought by oneself." 命由我作,福自己求。</p>
        <p>The full story, the four lessons, and how Yuan outran his predicted fate: <a href="/ch/332liaofan">Chapter 3.3.2 LiaoFan's Four Lessons 了凡四训</a>.</p>
        <h4 class="chap-h3">The RuDao Distinction</h4>''',
    cur, flags=re.S)

# Chapter Review + Bridge go into the vermillion end-frame (site-wide rule)
cur = cur.replace('''        <h3 class="chap-h2">Chapter Review</h3>
        <p>Ru builds the machine; Dao tells it when not to run - together they form one operating system: inner sage, outer king.</p>
        <p>Water does not argue with the rock; it simply arrives where the rock cannot go. That is the Daoist half of the thesis: momentum, timing, reversal, the power of not forcing. But water without banks is a flood, and that is where Ru returns - discipline, ritual, self-cultivation as the root of all outer success. The tree image of this chapter now reads in both directions: Ru is the roots that hold, Dao is the sap that rises. A merchant with only roots is a monument; a merchant with only sap is a flood. RuDao is the whole tree.</p>
        <h4 class="chap-h3">Bridge to next chapter</h4>
        <p>And where is this dual system tested hardest? Not in the study - in the contest. On the battlefield, SunTzu discovered its outer limits. (Chapter 4)</p>''',
'''        <div class="chapter-end-frame" aria-label="Chapter Review and Bridge to next chapter">
        <p class="frame-label">Chapter Review</p>
        <p class="frame-lede">Ru builds the machine; Dao tells it when not to run - together they form one operating system: inner sage, outer king.</p>
        <p class="frame-text">Water does not argue with the rock; it simply arrives where the rock cannot go. That is the Daoist half of the thesis: momentum, timing, reversal, the power of not forcing. But water without banks is a flood, and that is where Ru returns - discipline, ritual, self-cultivation as the root of all outer success. The tree image of this chapter now reads in both directions: Ru is the roots that hold, Dao is the sap that rises. A merchant with only roots is a monument; a merchant with only sap is a flood. RuDao is the whole tree.</p>
        <hr class="frame-rule" />
        <p class="frame-label">Bridge to next chapter</p>
        <p class="frame-text">And where is this dual system tested hardest? Not in the study - in the contest. On the battlefield, SunTzu discovered its outer limits. (Chapter 4)</p>
        </div>''')

# pager: 3.3 now points forward to 3.3.1
cur = swap_pager(cur, "/ch/32ruanddao", "3.2 Ru &amp; Dao 儒与道",
                      "/ch/331saiweng", "3.3.1 SaiWeng's Lost Horse 塞翁失马")
write(TMPL, cur)

# ---------------------------------------------------------------- neighbours
p32 = os.path.join(ROOT, "ch", "32ruanddao.html")
s = read(p32)
s = s.replace('<span class="ttl">3.3 Daoism Stories 儒道四训</span>',
              '<span class="ttl">3.3 Daoism Stories: SaiWeng &amp; LiaoFan\'s Lessons</span>')
write(p32, s)

p40 = os.path.join(ROOT, "ch", "40ruvsstrategists.html")
s = read(p40)
s = re.sub(r'<a class="ch-pager-link prev" href="[^"]*"><span class="dir">&larr; Previous 上一章</span><span class="ttl">[^<]*</span></a>',
           '<a class="ch-pager-link prev" href="/ch/332liaofan"><span class="dir">&larr; Previous 上一章</span><span class="ttl">3.3.2 LiaoFan\'s Four Lessons 了凡四训</span></a>', s)
write(p40, s)

print("3.3 -> overview done; 3.3.1 / 3.3.2 written")
for f in ("ch/331saiweng.html", "ch/332liaofan.html"):
    s = read(os.path.join(ROOT, f))
    print(f, "canonical:", re.search(r'rel="canonical" href="([^"]+)"', s).group(1))
