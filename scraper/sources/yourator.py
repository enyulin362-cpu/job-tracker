"""Yourator：網站列表頁使用的公開 JSON API。"""
import urllib.parse

NAME = "Yourator"
API = "https://www.yourator.co/api/v4/jobs?term[]={kw}&page={page}"


def fetch(http, cfg, rules, known):
    sc = cfg["sources"]["yourator"]
    out, seen, errors = [], set(), []
    for kw in sc["keywords"]:
        for page in range(1, int(sc.get("pages", 2)) + 1):
            try:
                p = http.json(API.format(kw=urllib.parse.quote(kw), page=page), headers={"Accept": "application/json"})["payload"]
            except Exception as e:
                errors.append(f"{kw}: {e}")
                break
            for j in p.get("jobs", []):
                path = j.get("path")
                if not path or path in seen:
                    continue
                seen.add(path)
                if sc.get("entry_level_only") and not rules.is_entry(j.get("name", "")):
                    continue
                tags = [t if isinstance(t, str) else str(t.get("name", "")) for t in (j.get("tags") or [])]
                out.append({
                    "title": j.get("name", "").strip(),
                    "company": (j.get("company") or {}).get("brand", "未提供"),
                    "location": j.get("location") or "未提供",
                    "salary": j.get("salary") or "未提供",
                    "date": None, "dateText": j.get("lastActiveAt", ""),  # Yourator 只給相對時間
                    "source": NAME, "url": "https://www.yourator.co" + path,
                    "_desc": "標籤：" + "、".join(tags[:8]),
                })
            if not p.get("hasMore"):
                break
    return out, errors
