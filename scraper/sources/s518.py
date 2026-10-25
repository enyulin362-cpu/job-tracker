"""518 熊班：解析公開搜尋結果頁 HTML。"""
import re
import urllib.parse
from ..common import strip_tags, today

NAME = "518"
URL = "https://www.518.com.tw/job-index-P-{page}.html?ad={kw}"
CARD = re.compile(r'<div class="job__card[^"]*" data-id="(\w+)" data-url="([^"]+)">(.*?)<ul class="job__tags">', re.S)


def _date(mmdd):
    m = re.match(r"(\d{1,2})/(\d{1,2})", mmdd or "")
    if not m:
        return None
    t = today()
    y = t.year if (int(m.group(1)), int(m.group(2))) <= (t.month, t.day) else t.year - 1
    return f"{y}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"


def fetch(http, cfg, rules, known):
    sc = cfg["sources"]["518"]
    out, seen, errors = [], set(), []
    for kw in sc["keywords"]:
        for page in range(1, int(sc.get("pages", 1)) + 1):
            try:
                s = http.text(URL.format(page=page, kw=urllib.parse.quote(kw)))
            except Exception as e:
                errors.append(f"{kw}: {e}")
                break
            for jid, url, body in CARD.findall(s):
                if url in seen:
                    continue
                seen.add(url)
                g = lambda pat: (re.search(pat, body, re.S) or [None, ""])[1]
                summ = re.findall(r"<li>(.*?)</li>", g(r'job__summaries">(.*?)</ul>'), re.S)
                summ = [strip_tags(x) for x in summ]
                exp = next((x for x in summ if x.startswith("經歷")), "")
                if exp and not re.search(r"無|不拘", exp):
                    m = re.search(r"(\d+)", exp)
                    if m and int(m.group(1)) > rules.max_exp:
                        continue
                intro = strip_tags(g(r'job__intro">(.*?)</p>'))
                out.append({
                    "title": strip_tags(g(r'class="job__title[^"]*"[^>]*>(.*?)</a>')),
                    "company": strip_tags(g(r'job__comp__name">(.*?)</span>')),
                    "location": summ[0] if summ else "未提供",
                    "experience": exp.replace("經歷", "") or "未提供",
                    "salary": strip_tags(g(r'job__salary">(.*?)</p>')) or "未提供",
                    "date": _date(strip_tags(g(r'job__date">(.*?)</span>'))),
                    "source": NAME, "url": url, "_desc": intro[:400],
                })
    return out, errors
