#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 积累.xlsx 的 github 表提取词库，输出 data/words.js"""
import json, re, unicodedata, collections, sys
import openpyxl

SRC = "/root/.claude/uploads/5401e185-d464-5e05-8674-9612d44dfeb0/43d11482-__.xlsx"

wb = openpyxl.load_workbook(SRC, data_only=True)
ws = wb["github"]
rows = list(ws.iter_rows(min_row=1, values_only=True))

raw = []
unit = None
for i, r in enumerate(rows, 1):
    if i < 45:
        continue
    vals = [v for v in r if v not in (None, "")]
    if len(vals) == 1 and isinstance(vals[0], str) and vals[0].startswith("A1"):
        unit = vals[0].replace("A1 ", "").strip()  # U1..U8
        continue
    if r[0] == "序号" or not r[1]:
        continue
    raw.append(dict(row=i, unit=unit, num=r[0], word=str(r[1]).strip(),
                    ipa=(str(r[2]).strip() if r[2] else ""),
                    pos=(str(r[3]).strip() if r[3] else ""),
                    en=(str(r[4]).strip() if r[4] else ""),
                    zh=(str(r[5]).strip() if r[5] else ""),
                    note=(str(r[6]).strip() if r[6] else ""),
                    level=(r[7] if r[7] else 2)))

ART = re.compile(r"^(les|le|la|l'|l’|un|une|des)\s*", re.I)

def strip_article(w):
    m = ART.match(w)
    if not m:
        return w, ""
    art = m.group(1).lower().replace("’", "'")
    rest = w[m.end():].strip()
    if not rest:
        return w, ""
    return rest, art

def norm_pos(p):
    p = p.replace(" ", "").replace(";", "；").replace(",", "；")
    p = p.replace("n.f", "n.f.").replace("n.f..", "n.f.")
    p = p.replace("n.m", "n.m.").replace("n.m..", "n.m.")
    p = re.sub(r"\.{2,}", ".", p)
    return p

def is_fem_variant(p):
    p = norm_pos(p)
    return bool(re.match(r"^(adj|n)\.[^；]*f\.", p)) or p in ("adj.f.", "n.f.")

def base_pos(p):
    """粗分类，用于提示"""
    p = norm_pos(p)
    if p.startswith("n."):
        return "n."
    if p.startswith("v."):
        return "v."
    if p.startswith("adj"):
        return "adj."
    if p.startswith("adv"):
        return "adv."
    if p.startswith("prep") or p.startswith("loc.prep"):
        return "prep."
    if p.startswith("conj"):
        return "conj."
    if p.startswith("pron"):
        return "pron."
    if p.startswith("interj"):
        return "interj."
    if p.startswith("loc"):
        return "loc."
    if p.startswith("det"):
        return "det."
    return p or "—"

def deacc(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")

def common_prefix(a, b):
    a, b = deacc(a), deacc(b)
    n = 0
    while n < min(len(a), len(b)) and a[n] == b[n]:
        n += 1
    return n

def senses(z):
    return [s.strip() for s in re.split(r"[;；,，、]", z) if s.strip()]

# ---- 第一遍：合并阴性形式 ----
entries = []
dropped = []
for r in raw:
    fem_like = False
    if entries:
        prev = entries[-1]
        fw0, _ = strip_article(r["word"])
        pref = common_prefix(fw0, prev["fr"])
        same_family = pref >= 3 and len(fw0) >= len(prev["fr"]) - 3
        zh_sub = (not r["zh"]) or (senses(r["zh"]) and all(s in senses(prev["zh"]) for s in senses(r["zh"])))
        if same_family and zh_sub and not prev.get("fem"):
            # 词形相近 + 中文无新增信息 → 视为同一词的阴性/变体形式
            if is_fem_variant(r["pos"]) or (not r["zh"] and not r["en"]):
                fem_like = True
    if fem_like:
        prev = entries[-1]
        fw, _ = strip_article(r["word"])
        prev["fem"] = fw
        prev["fem_ipa"] = r["ipa"]
        if r["note"]:
            prev["fem_note"] = r["note"]
        continue
    zh = r["zh"]
    if not zh:
        # 没有中文：极少数，退回备注 / 英译，都没有则丢弃
        zh = r["note"] or r["en"]
        if not zh:
            dropped.append(r)
            continue
    fr, art = strip_article(r["word"])
    p = norm_pos(r["pos"])
    gender = None
    if re.search(r"n\.[a-z.]*m\.", p) or (p.startswith("n.") and "m." in p):
        gender = "m"
    if re.search(r"n\.[a-z.]*f\.", p) or (p.startswith("n.") and "f." in p):
        gender = "f" if gender is None else gender
    if "n.m." in p and "n.f." in p:
        gender = None
    if gender is None:
        if art == "le":
            gender = "m"
        elif art == "la":
            gender = "f"
    plural = ("pl." in p) or art in ("les", "des")
    entries.append(dict(row=r["row"], fr=fr, article=art, pos=p, posBase=base_pos(p),
                        gender=(None if plural else gender), plural=plural,
                        zh=zh, ipa=r["ipa"], note=r["note"], en=r["en"],
                        unit=r["unit"], level=r["level"]))

# ---- 第二遍：同一法语词合并 ----
merged = {}
order = []
for e in entries:
    key = e["fr"].lower()
    if key in merged:
        m = merged[key]
        # 合并中文释义
        senses = [s for s in re.split(r"[;；]", m["zh"]) if s]
        for s in re.split(r"[;；]", e["zh"]):
            if s and s not in senses:
                senses.append(s)
        m["zh"] = ";".join(senses)
        if e["unit"] not in m["units"]:
            m["units"].append(e["unit"])
        if not m["ipa"] and e["ipa"]:
            m["ipa"] = e["ipa"]
        if e["note"] and e["note"] not in m["note"]:
            m["note"] = (m["note"] + " / " + e["note"]).strip(" /")
        if not m.get("fem") and e.get("fem"):
            m["fem"] = e["fem"]; m["fem_ipa"] = e.get("fem_ipa", "")
        if m["gender"] is None and e["gender"]:
            m["gender"] = e["gender"]
        m["level"] = max(m["level"], e["level"])
    else:
        e["units"] = [e["unit"]]
        merged[key] = e
        order.append(key)

final = []
for idx, key in enumerate(order, 1):
    e = merged[key]
    src = next((x for x in entries if x["fr"].lower() == key), e)
    fem = None
    fem_ipa = ""
    for x in entries:
        if x["fr"].lower() == key and x.get("fem"):
            fem = x["fem"]; fem_ipa = x.get("fem_ipa", "")
            break
    ipa = e["ipa"]
    if e["article"]:
        # 音标里若含冠词（/lə badʒ/），去掉冠词部分
        ipa = re.sub(r"^/\s*(l[əaeœ]|le|la|les|de|dε)\s+", "/", ipa)
    o = {
        "id": "w%04d" % idx,
        "fr": e["fr"],
        "article": e["article"],
        "pos": e["pos"],
        "posBase": e["posBase"],
        "gender": e["gender"],
        "plural": e["plural"],
        "zh": e["zh"],
        "ipa": ipa,
        "note": e["note"],
        "tags": e["units"],
        "level": e["level"],
    }
    # 只有单数普通名词且性别明确，才出 le/la 卡
    o["genderCard"] = bool(e["posBase"] == "n." and e["gender"] and not e["plural"])
    if fem:
        o["fem"] = fem
        if fem_ipa:
            o["femIpa"] = fem_ipa
    final.append(o)

print("原始行:", len(raw), " 词条:", len(final), " 丢弃:", len(dropped))
for d in dropped:
    print("  DROP", d["row"], d["word"], d["pos"])
print("有阴性形式:", sum(1 for e in final if e.get("fem")))
print("有性别(可出 le/la 卡):", sum(1 for e in final if e["gender"] and not e["plural"]))
print("单元分布:", collections.Counter(t for e in final for t in e["tags"]))
print("词性分布:", collections.Counter(e["posBase"] for e in final).most_common())
print("无音标:", sum(1 for e in final if not e["ipa"]))

# 中文歧义统计
zhmap = collections.defaultdict(list)
for e in final:
    for s in re.split(r"[;；,，、]", e["zh"]):
        s = s.strip()
        if s:
            zhmap[s].append(e["fr"])
amb = {k: v for k, v in zhmap.items() if len(v) > 1}
print("一对多中文释义数:", len(amb))
print(list(amb.items())[:15])

with open("data/words.js", "w", encoding="utf-8") as f:
    f.write("// 法语 A1 词库 —— 由 积累.xlsx 的 github 表自动生成\n")
    f.write("// 字段: id, fr, article, pos, posBase, gender(m/f/null), plural, zh, ipa, note, tags, level, fem, femIpa\n")
    f.write("window.WORD_BANK = ")
    f.write(json.dumps(final, ensure_ascii=False, indent=0).replace("\n", ""))
    f.write(";\n")
    f.write("window.WORD_BANK_VERSION = 'xlsx-github-%d';\n" % len(final))
print("written data/words.js")
