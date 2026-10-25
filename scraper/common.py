"""共用工具：禮貌的 HTTP 請求、文字清理、規則式篩選與分類。"""
import html
import re
import time
import datetime as dt

import requests

TZ = dt.timezone(dt.timedelta(hours=8))  # 台北時間


def today():
    return dt.datetime.now(TZ).date()


class Http:
    """有延遲、User-Agent、逾時與重試的簡單 HTTP 客戶端。"""

    def __init__(self, cfg):
        h = cfg.get("http", {})
        self.delay = float(h.get("delay_seconds", 1.2))
        self.timeout = float(h.get("timeout_seconds", 20))
        self.s = requests.Session()
        self.s.headers.update({
            "User-Agent": h.get("user_agent", "Mozilla/5.0"),
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        })
        self._last = 0.0
        self.count = 0

    def get(self, url, headers=None, retries=1, **kw):
        for attempt in range(retries + 1):
            wait = self.delay - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()
            self.count += 1
            try:
                r = self.s.get(url, headers=headers or {}, timeout=self.timeout, **kw)
                if r.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                    time.sleep(3 * (attempt + 1))
                    continue
                r.raise_for_status()
                return r
            except requests.RequestException:
                if attempt >= retries:
                    raise
                time.sleep(3 * (attempt + 1))

    def text(self, url, **kw):
        r = self.get(url, **kw)
        r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else r.apparent_encoding
        return r.text

    def json(self, url, **kw):
        return self.get(url, **kw).json()


def strip_tags(s):
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s or "", flags=re.S | re.I)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"[ \t\u3000\xa0]+", " ", s).strip()


def one_line(s, n=None):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s[:n] if n else s


def any_in(text, words):
    t = text or ""
    return next((w for w in words if w and w in t), None)


DAY_RE = re.compile(
    r"((每週|每周|一週|一周|週|周)\s*[一二三四五六日\d１-９]\s*[-~～至到、]?\s*[一二三四五六日\d]?\s*(天|日|次)(以上)?"
    r"|(每週|每周|一週|一周|星期|週|周)[一二三四五六日](\s*[、,，/至~～\-]\s*[一二三四五六日])+"
    r"|(週|周|星期)[一二三四五六日]\s*(至|到|~|～|-)\s*(週|周|星期)?[一二三四五六日]"
    r"|\d\s*[~～\-]\s*\d\s*(天|日)|任選\s*\d"
    r"|週休二日|排班制|彈性排班|可排班|\d+\s*天\s*以上|(週末|假日|平日)\s*(的)?\s*(晚|早|上午|下午|白天|\d|皆可|可))"
)


def guess_work_days(*texts):
    """從文字中找工作天數相關描述；找不到回傳「未提供」。"""
    for t in texts:
        if not t:
            continue
        for line in re.split(r"[\n。；;]", t):
            m = DAY_RE.search(line)
            if m:
                line = re.sub(r"^[\-\s•・\d\.、◆*●■▲>]+", "", line).strip()
                return one_line(line, 45)
    return "未提供"


SAL_RE = re.compile(r"(時薪|月薪|日薪|薪資|待遇|鐘點費|每小時)\s*[:：]?\s*\$?\s*\d[\d,]*\s*(元)?(\s*[-~～至]\s*\d[\d,]*)?|\d{3,4}\s*(元)?\s*/\s*(hr|小時|時|h)", re.I)


def guess_salary(*texts):
    for t in texts:
        m = SAL_RE.search(t or "")
        if m:
            return one_line(m.group(0), 30)
    return "未提供"


class Rules:
    """規則式篩選＋分類（不用 AI）。"""

    def __init__(self, cfg):
        self.cfg = cfg
        self.loc = cfg["locations"]["include"]
        ex = cfg["exclude"]
        self.excl = ex.get("service_keywords", []) + ex.get("seniority_keywords", []) + ex.get("other_keywords", [])
        self.max_exp = ex.get("max_experience_years", 1)
        self.cats = cfg["categories"]
        self.intern_kw = cfg.get("intern_keywords", [])
        self.remote_kw = cfg.get("remote_keywords", [])
        self.entry_kw = cfg.get("entry_keywords", [])

    def is_entry(self, title):
        return bool(any_in(title, self.entry_kw))

    def category(self, title, hint=None):
        for c in self.cats:
            if any_in(title, c["title_keywords"]):
                return c["name"]
        return hint

    def excluded(self, title, company=""):
        return any_in(title, self.excl) or any_in(company, self.cfg["exclude"].get("service_keywords", []))

    def location_ok(self, location, remote=False):
        return remote or bool(any_in(location, self.loc))

    def is_intern(self, *texts):
        return any(any_in(t, self.intern_kw) for t in texts)

    def is_remote(self, *texts):
        return any(any_in(t, self.remote_kw) for t in texts)

    def finalize(self, job, hint=None):
        """套用所有規則，回傳補齊欄位的 job，或 None（被濾掉）。"""
        title = job.get("title", "")
        if self.excluded(title, job.get("company", "")):
            return None
        remote = job.get("remote") or self.is_remote(title, job.get("onsiteDays", ""), job.get("location", ""))
        if not self.location_ok(job.get("location", ""), remote):
            return None
        cat = job.get("category") or self.category(title, None)
        if not cat:
            return None
        base = {
            "category": cat, "title": title, "company": "未提供", "location": "未提供", "type": "未提供",
            "experience": "未提供", "workDays": "未提供", "onsiteDays": "未提供", "salary": "未提供",
            "date": None, "dateText": "", "source": "", "url": "", "firstSeen": today().isoformat(),
            "remote": bool(remote), "intern": False, "informal": False, "fitNote": "",
        }
        base.update({k: v for k, v in job.items() if v not in (None, "")})
        base["category"] = cat
        base["remote"] = bool(remote)
        base["intern"] = bool(job.get("intern")) or self.is_intern(title, job.get("type", ""))
        if base["intern"] and base["type"] == "未提供":
            base["type"] = "實習"
        return base
