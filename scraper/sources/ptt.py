"""PTT 看板（HomeTeach 家教板、part-time 打工板）：公開網頁版。"""
import datetime as dt
import re
from ..common import strip_tags, guess_salary, guess_work_days, one_line, TZ

NAME = "PTT"
BASE = "https://www.ptt.cc"
ENT = re.compile(r'<div class="r-ent">.*?<div class="title">\s*(?:<a href="([^"]+)">(.*?)</a>)?.*?<div class="author">(.*?)</div>', re.S)


def _post_date(path):
    m = re.search(r"M\.(\d{9,11})\.", path)
    return dt.datetime.fromtimestamp(int(m.group(1)), TZ).date().isoformat() if m else None


def fetch(http, cfg, rules, known):
    sc = cfg["sources"]["ptt"]
    out, errors = [], []
    for board in sc.get("boards", []):
        url = f"{BASE}/bbs/{board}/index.html"
        name = f"PTT {board}"
        for _ in range(int(sc.get("index_pages", 3))):
            try:
                s = http.text(url, cookies={"over18": "1"})
            except Exception as e:
                errors.append(f"{board}: {e}")
                break
            # 只取置底公告分隔線之前的文章
            s_main = s.split('<div class="r-list-sep"></div>')[0]
            for path, title, author in ENT.findall(s_main):
                if not path:
                    continue
                title = strip_tags(title)
                if board.lower() == "hometeach":
                    if not any(title.startswith(t) for t in sc.get("hometeach_tags", ["[家教]"])):
                        continue
                    cat = "家教伴讀"
                else:
                    if not any(title.startswith(p) for p in sc.get("parttime_region_prefix", [])):
                        continue
                    cat = None
                m = re.match(r"\s*[\[【［]([^\]】］]*)[\]】］]\s*(.*)", title)
                region = m.group(1) if m else ""
                clean = m.group(2) if m else title
                out.append({
                    "title": one_line(clean, 80) or title, "company": f"PTT 網友 {strip_tags(author)}",
                    "location": region if board.lower() != "hometeach" else (clean.split()[0] if clean.split() and rules.location_ok(clean.split()[0]) else clean),
                    "type": "家教" if cat else "工讀", "date": _post_date(path),
                    "source": name, "url": BASE + path, "informal": True, "category": cat,
                    "fitNote": "非正式貼文，未經查證",
                })
            prev = re.search(r'href="(/bbs/[^"]+/index\d+\.html)"[^>]*>[^<]*上頁', s)
            if not prev:
                break
            url = BASE + prev.group(1)
    # 抓新文章內文找時薪、天數（只抓新的，且先過規則）
    if sc.get("fetch_body", True):
        for job in out:
            if job["url"] in known:
                continue
            if rules.excluded(job["title"]) or not (job.get("category") or rules.category(job["title"])):
                continue
            try:
                s = http.text(job["url"], cookies={"over18": "1"})
            except Exception as e:
                errors.append(f"post: {e}")
                continue
            body = s.split('<div id="main-content"', 1)[-1].split("※ 發信站", 1)[0]
            body = re.sub(r'<div class="article-metaline.*?</div>\s*</div>', "", body, flags=re.S)
            text = strip_tags(body)
            job["salary"] = guess_salary(text)
            job["workDays"] = guess_work_days(text)
            job["_desc"] = one_line(text, 400)
            if not rules.location_ok(job["location"]):
                m = re.search(r"(地點|地區|上課地點|工作地點)\s*[:：]\s*(.{2,30})", text)
                if m:
                    job["location"] = one_line(m.group(2), 30)
    return out, errors
