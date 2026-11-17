# -*- coding: utf-8 -*-
"""RuDao.org content edits 2026-11-18 (website only, per user request)."""
import io, re, sys

def load(p): return io.open(p, encoding="utf-8").read()
def save(p, s): io.open(p, "w", encoding="utf-8", newline="").write(s)

def rep1(s, old, new, label, path):
    n = s.count(old)
    if n != 1:
        print(f"  !! {path} :: {label} -> found {n} occurrences (expected 1), SKIPPED")
        return s
    print(f"  ok {path} :: {label}")
    return s.replace(old, new)

def repn(s, old, new, label, path, expect=None):
    n = s.count(old)
    if expect is not None and n != expect:
        print(f"  !! {path} :: {label} -> found {n} (expected {expect}), SKIPPED")
        return s
    print(f"  ok {path} :: {label} x{n}")
    return s.replace(old, new)

# ---------- 1. ch/10roots.html : Anyang, shangren, shangye, ShangRen, BaDe ----------
p = "ch/10roots.html"; s = load(p)
s = repn(s, "Anyang", "AnYang", "Anyang->AnYang", p, 4)
s = rep1(s, "a shangren, a man of Shang", "a ShangRen, a man of Shang", "shangren->ShangRen", p)
s = rep1(s, "shangye, business", "ShangYe, business", "shangye->ShangYe", p)
s = rep1(s, "ShangR\u00e9n \u5546\u4eba", "ShangRen \u5546\u4eba", "ShangRen(acc)->ShangRen", p)
s = rep1(s, "(B\u0101D\u00e9 \u516b\u5fb7)", "(BaDe \u516b\u5fb7)", "BaDe->BaDe", p)
save(p, s)

# ---------- 2. ch/20whatisrudao.html : zhexue, zheren, heading rename, remove Adam Smith ----------
p = "ch/20whatisrudao.html"; s = load(p)
s = rep1(s, "the word zhexue (\u54f2\u5b66)", "the word ZheXue (\u54f2\u5b66)", "zhexue->ZheXue", p)
s = rep1(s, "called a zheren (\u54f2\u4eba)", "called a ZheRen (\u54f2\u4eba)", "zheren->ZheRen", p)
s = rep1(s, '<h4 class="chap-h3">The Chinese Counterpart</h4>\n        <p class="chap-h3-cn">\u4f26\u7406\u4e0e\u9053\u5fb7</p>',
         '<h4 class="chap-h3">The Chinese Counterpart - LunLi &amp; DaoDe</h4>\n        <p class="chap-h3-cn">\u4f26\u7406\u4e0e\u9053\u5fb7</p>',
         "heading + LunLi & DaoDe", p)

# extract the Adam Smith block (lines 537-551) and remove it
lines = s.split("\n")
i_h = next(i for i, l in enumerate(lines) if "RuDao \u00d7 Adam Smith: The Invisible Hand" in l)
i_end = next(i for i in range(i_h, len(lines)) if lines[i].strip() == "</div>")  # closes zh-Hans div
block = "\n".join(lines[i_h:i_end + 1])
assert "<h3" in block and "Adam Smith" in block and block.count("</div>") == 1
del lines[i_h:i_end + 1]
s = "\n".join(lines)
save(p, s)
save("tools/_adamsmith_block.html", block)   # stash for ch64 insert
print(f"  ok {p} :: Adam Smith block removed ({i_end - i_h + 1} lines)")

# ---------- 3. ch/72glossary.html ----------
p = "ch/72glossary.html"; s = load(p)
s = rep1(s, "Called zheren (\u54f2\u4eba)", "Called ZheRen (\u54f2\u4eba)", "zheren->ZheRen", p)
s = rep1(s, "Coined \u54f2\u5b66 (zhexue)", "Coined \u54f2\u5b66 (ZheXue)", "zhexue->ZheXue", p)
s = rep1(s, '<td class="glossary-py">B\u0101D\u00e9</td>', '<td class="glossary-py">BaDe</td>', "BaDe->BaDe", p)
save(p, s)

# ---------- 4. faq.html / guide.html : Zigong ----------
for p, n in (("faq.html", 2), ("guide.html", 2)):
    s = load(p); s = repn(s, "Zigong", "ZiGong", "Zigong->ZiGong", p, n); save(p, s)

# ---------- 5. ch/64clashofcivilizations.html : Zigong, HuaXue, Bell paren, insert Adam Smith ----------
p = "ch/64clashofcivilizations.html"; s = load(p)
s = rep1(s, "Zigong (\u5b50\u8d21", "ZiGong (\u5b50\u8d21", "Zigong->ZiGong", p)
s = rep1(s, "HuaXie", "HuaXue", "HuaXie->HuaXue (typo)", p)
s = rep1(s, "(Princeton University Press, 2015;  Bell describes",
         "(Princeton University Press, 2015). Bell describes", "Bell paren fixed", p)
block = load("tools/_adamsmith_block.html")
s = rep1(s, '        <h3 class="chap-h2">The Weberian Parallel: Protestant Ethic and RuShang Ethic Compared</h3>',
         block + '\n        <h3 class="chap-h2">The Weberian Parallel: Protestant Ethic and RuShang Ethic Compared</h3>',
         "insert Adam Smith before Weberian", p)
save(p, s)

# ---------- 6. ch/42coopetition.html : delete closing sentence ----------
p = "ch/42coopetition.html"; s = load(p)
s = rep1(s, " Flexible operational choices are the y\u00f2ng \u7528, but the moral anchor - x\u00ecn and y\u00ec - remains the unchanging t\u01d3 \u4f53.",
         "", "delete flexible-operational sentence", p)
save(p, s)

# ---------- 7. ch/32ruanddao.html : delete Bridge block (hr + label + text) ----------
p = "ch/32ruanddao.html"; s = load(p)
s = rep1(s, '        <hr class="frame-rule" />\n        <p class="frame-label">Bridge to next chapter</p>\n        <p class="frame-text">And where is this dual system tested hardest? Not in the study - in the contest. On the battlefield, SunTzu discovered its outer limits. (Chapter 4)</p>\n',
         "", "delete 3.2 bridge block", p)
save(p, s)

# ---------- 8. index.html : add 6.4 TOC bullet ----------
p = "index.html"; s = load(p)
s = rep1(s, '                                <li>Weberian Parallel: Protestant Ethic vs RuShang \u4e49\u5229\u5408\u4e00 - \u65b0\u6559\u4f26\u7406\u4e0e\u5112\u5546\u4f26\u7406</li>',
         '                                <li>RuDao x Adam Smith: The Invisible Hand - \u5112\u9053\u4e0e\u4e9a\u5f53-\u65af\u5bc6:\u770b\u4e0d\u89c1\u7684\u624b</li>\n'
         '                                <li>Weberian Parallel: Protestant Ethic vs RuShang \u4e49\u5229\u5408\u4e00 - \u65b0\u6559\u4f26\u7406\u4e0e\u5112\u5546\u4f26\u7406</li>',
         "TOC bullet for 6.4 Adam Smith", p)
save(p, s)

# ---------- 9. llms.txt : Zigong + add Adam Smith to 6.4 line, 2.0 line ----------
p = "llms.txt"; s = load(p)
s = repn(s, "Zigong", "ZiGong", "Zigong->ZiGong", p, 2)
s = rep1(s, "the Weberian parallel: Protestant ethic vs RuShang \u4e49\u5229\u5408\u4e00 (ZiGong \u5b50\u8d21)",
         "RuDao x Adam Smith invisible hand \u770b\u4e0d\u89c1\u7684\u624b; the Weberian parallel: Protestant ethic vs RuShang \u4e49\u5229\u5408\u4e00 (ZiGong \u5b50\u8d21)",
         "llms 6.4 line + Adam Smith", p)
save(p, s)

# ---------- 10. h5/index.html : same fixes inside embedded book data ----------
p = "h5/index.html"; s = load(p)
s = repn(s, "Zigong", "ZiGong", "Zigong->ZiGong", p, 7)
s = repn(s, "B\u0101D\u00e9", "BaDe", "BaDe->BaDe", p, 2)
s = repn(s, "zhexue", "ZheXue", "zhexue->ZheXue", p, 2)
s = repn(s, "zheren", "ZheRen", "zheren->ZheRen", p, 2)
s = repn(s, "Anyang", "AnYang", "Anyang->AnYang", p, 0)  # 0 expected
# rename the ETHICS heading (2nd occurrence, followed by 伦理与道德)
old = 'The Chinese Counterpart<\\/h4>\\n<p class="chap-h3-cn"><span class=\\"zh\\">\u4f26\u7406\u4e0e\u9053\u5fb7'
if s.count('The Chinese Counterpart') == 2:
    i1 = s.find("The Chinese Counterpart")
    i2 = s.find("The Chinese Counterpart", i1 + 1)
    seg = s[i2:i2 + 200]
    if "\u4f26\u7406\u4e0e\u9053\u5fb7" in seg:
        s = s[:i2] + "The Chinese Counterpart - LunLi &amp; DaoDe" + s[i2 + len("The Chinese Counterpart"):]
        print("  ok h5 :: ethics heading renamed")
    else:
        print("  !! h5 :: 2nd Chinese Counterpart not ethics, SKIPPED")
# delete flexible sentence (h5 has zh spans inside)
flex_pat = (" Flexible operational choices are the y\u00f2ng <span class=\\\"zh\\\">\u7528,<\\/span> "
            "but the moral anchor - x\u00ecn and y\u00ec - remains the unchanging t\u01d3 "
            "<span class=\\\"zh\\\">\u4f53\\.<\\/span>\\.")
m = re.search(re.escape(flex_pat), s)
if m:
    s = s[:m.start()] + s[m.end():]
    print("  ok h5 :: flexible-operational sentence deleted")
else:
    print("  !! h5 :: flexible sentence NOT matched")
save(p, s)

print("ALL DONE")
