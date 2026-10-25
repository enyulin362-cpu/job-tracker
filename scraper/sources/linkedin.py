"""LinkedIn：不登入的公開職缺搜尋（guest）頁面。"""
import re
import urllib.parse
from ..common import strip_tags

NAME = "LinkedIn"
API = ("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={kw}"
       "&location={loc}&f_TPR=r2592000&f_E=1%2C2&start={start}")
CARD = re.compile(
    r'base-card__full-link[^>]*href="([^"?]+)[^>]*>\s*<span class="sr-only">\s*(.*?)\s*</span>'
    r'.*?base-search-card__subtitle">(.*?)</h4>.*?job-search-card__location">\s*(.*?)\s*</span>'
    r'(?:.*?datetime="([^"]+)")?', re.S)


def fetch(http, cfg, rules, known):
    sc = cfg["sources"]["linkedin"]
    out, seen, errors = [], set(), []
    loc = urllib.parse.quote(sc.get("location", "Taipei City, Taiwan"))
    for kw in sc["keywords"]:
        for pg in range(int(sc.get("pages", 2))):
            try:
                s = http.text(API.format(kw=urllib.parse.quote(kw), loc=loc, start=pg * 25))
            except Exception as e:
                errors.append(f"{kw}: {e}")
                break
            cards = s.split('<li>')
            n = 0
            for c in cards:
                m = CARD.search(c)
                if not m:
                    continue
                n += 1
                url, title, comp, place, date = m.groups()
                jid = re.search(r"(\d{8,})$", url)
                url = f"https://www.linkedin.com/jobs/view/{jid.group(1)}" if jid else url
                if url in seen:
                    continue
                seen.add(url)
                out.append({
                    "title": strip_tags(title), "company": strip_tags(comp), "location": strip_tags(place),
                    "date": date, "source": NAME, "url": url, "experience": "入門／實習（LinkedIn 篩選）",
                })
            if n < 25:
                break
    return out, errors
