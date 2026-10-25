"""104 人力銀行：使用網站搜尋頁本身呼叫的公開 JSON。"""
import urllib.parse
from ..common import guess_work_days, one_line

NAME = "104"
SEARCH = "https://www.104.com.tw/jobs/search/api/jobs?keyword={kw}&page={page}&pagesize=30&order=1{area}{extra}"
DETAIL = "https://www.104.com.tw/job/ajax/content/{code}"
RO = {1: "正職", 2: "兼職／工讀", 3: "高階"}
SAL = {10: "待遇面議", 20: "論件計酬", 30: "時薪", 40: "日薪", 50: "月薪", 60: "年薪"}


def salary(j):
    t = SAL.get(j.get("s10"), "")
    lo, hi = j.get("salaryLow") or 0, j.get("salaryHigh") or 0
    if j.get("s10") == 10 or not lo:
        return t or "未提供"
    if hi and hi != lo and hi < 9999999:
        return f"{t} {lo:,}~{hi:,}"
    return f"{t} {lo:,}" + (" 以上" if hi >= 9999999 else "")


def onsite_from(rw_type, desc=""):
    if rw_type == 1:
        return "完全遠端" + ("：" + one_line(desc, 40) if desc else "")
    if rw_type == 2:
        return "部分遠端" + ("：" + one_line(desc, 40) if desc else "")
    return "未標示遠端（實體）"


def fetch(http, cfg, rules, known):
    sc = cfg["sources"]["104"]
    hdr = {"Referer": "https://www.104.com.tw/jobs/search/"}
    out, seen = [], set()
    plans = [(k, "&area=" + sc.get("area", "6001001000,6001002000"), False) for k in sc["keywords"]]
    plans += [(k, "&remoteWork=1", True) for k in sc.get("remote_keywords", [])]
    errors = []
    for spec, area, remote_only in plans:
        kw, _, extra = spec.partition("|")
        for page in range(1, int(sc.get("pages", 1)) + 1):
            url = SEARCH.format(kw=urllib.parse.quote(kw.strip()), page=page, area=area, extra=extra.strip())
            try:
                data = http.json(url, headers=hdr).get("data", [])
            except Exception as e:  # 單一關鍵字失敗不影響其他
                errors.append(f"{kw}: {e}")
                break
            for j in data:
                link = (j.get("link") or {}).get("job", "")
                if not link or link in seen:
                    continue
                if remote_only and j.get("remoteWorkType") != 1:
                    continue
                if (j.get("period") or 0) > rules.max_exp:
                    continue
                seen.add(link)
                d = str(j.get("appearDate", ""))
                out.append({
                    "title": j.get("jobName", "").strip(), "company": j.get("custName", "").strip(),
                    "location": j.get("jobAddrNoDesc") or "未提供",
                    "type": RO.get(j.get("jobRo"), "未提供"),
                    "experience": "不拘" if not j.get("period") else f"{j['period']} 年以上",
                    "salary": salary(j),
                    "date": f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else None,
                    "source": NAME, "url": link,
                    "remote": j.get("remoteWorkType") == 1,
                    "onsiteDays": onsite_from(j.get("remoteWorkType")),
                    "workDays": guess_work_days(j.get("description", "")),
                    "_desc": one_line(j.get("description", ""), 400),
                })
            if len(data) < 30:
                break
    # 只對「新」職缺抓詳細頁（工作時段、遠端說明）
    if sc.get("fetch_details", True):
        n = 0
        for job in out:
            if job["url"] in known or n >= int(sc.get("max_details_per_run", 80)):
                continue
            if rules.excluded(job["title"], job["company"]) or not rules.category(job["title"]):
                continue
            code = job["url"].rstrip("/").rsplit("/", 1)[-1]
            n += 1
            try:
                d = http.json(DETAIL.format(code=code), headers={"Referer": job["url"]})["data"]
            except Exception as e:
                errors.append(f"detail {code}: {e}")
                continue
            jd = d.get("jobDetail", {})
            rw = jd.get("remoteWork") or {}
            wp = jd.get("workPeriod") or {}
            job["workDays"] = guess_work_days(wp.get("note", ""), jd.get("jobDescription", ""), d.get("condition", {}).get("other", ""))
            if job["workDays"] == "未提供" and jd.get("vacationPolicy") in ("週休二日", "固定休六日"):
                job["workDays"] = "週休二日"
            if rw:
                job["onsiteDays"] = onsite_from(rw.get("type"), rw.get("description", ""))
                job["remote"] = rw.get("type") == 1
            job["salary"] = jd.get("salary") or job["salary"]
            job["experience"] = d.get("condition", {}).get("workExp") or job["experience"]
            job["_desc"] = one_line(jd.get("jobDescription", ""), 400)
    return out, errors
