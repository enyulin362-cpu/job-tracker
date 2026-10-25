"""1111 家教網：公開的家教案件搜尋頁（不需登入）。"""
import re
from ..common import strip_tags

NAME = "1111家教網"
BASE = "https://tutor.1111.com.tw"
URL = BASE + "/case/caseSearch.asp?{q}&newSearch=search&page={page}"


def fetch(http, cfg, rules, known):
    sc = cfg["sources"]["tutor1111"]
    out, seen, errors = [], set(), []
    for srch in sc.get("searches", []):
        for page in range(1, int(sc.get("pages", 2)) + 1):
            try:
                s = http.text(URL.format(q=srch["query"], page=page))
            except Exception as e:
                errors.append(f"{srch.get('label')}: {e}")
                break
            rows = re.split(r'<span class="mobiTitle">連絡人</span>', s)[1:]
            if not rows:
                if page == 1:
                    errors.append(f"{srch.get('label')}: 頁面沒有案件（可能改版或被擋）")
                break
            for r in rows:
                m = re.search(r'href="(/case/caseDetail\.asp\?CNo=\d+)"', r)
                if not m:
                    continue
                url = BASE + m.group(1)
                if url in seen:
                    continue
                seen.add(url)
                def field(label):
                    mm = re.search(r'mobiTitle">' + label + r'</span>\s*<span class="mobiContent[^"]*">(.*?)</span>', r, re.S)
                    return strip_tags(mm.group(1)) if mm else ""
                def li(label):
                    mm = re.search(r'listHeadline">' + label + r'.*?<span class="overflow">(.*?)</span>', r, re.S)
                    return strip_tags(mm.group(1)) if mm else ""
                subj, who = field("需求科目"), field("需求對象")
                sal = field("案件薪資")
                out.append({
                    "title": f"{subj}家教（{who}）" if who else f"{subj}家教",
                    "company": "1111家教網 家長案件", "location": li("上課地區") or "未提供",
                    "type": "家教", "salary": f"時薪 {sal}" if sal else "未提供",
                    "date": li("案件更新日") or None, "source": NAME, "url": url,
                    "category": "家教伴讀", "informal": True,
                    "_desc": f"科目 {subj}；對象 {who}；應徵人數 {field('應徵人數')}",
                })
    return out, errors
