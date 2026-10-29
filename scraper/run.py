"""主程式：依 config.yaml 抓取各來源 → 規則篩選 → 去重 → 合併進 docs/data/jobs.json。

用法（在專案根目錄）：  python -m scraper.run
只跑部分來源：          python -m scraper.run --only 104 ptt
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import traceback

import yaml

from .common import Http, Rules, today, TZ
from .sources import s104, s518, ptt, yourator, linkedin, tutor1111

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBS = os.path.join(ROOT, "docs", "data", "jobs.json")
META = os.path.join(ROOT, "docs", "data", "meta.json")
CACHE = os.path.join(ROOT, "scraper", ".cache")
SOURCES = {"104": s104, "518": s518, "ptt": ptt, "yourator": yourator, "linkedin": linkedin, "tutor1111": tutor1111}


def norm(s):
    return re.sub(r"[\s\W_]+", "", (s or "").lower())


def key_tc(j):
    return norm(j.get("title")) + "|" + norm(j.get("company"))


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def ref_date(j):
    for k in ("date", "firstSeen"):
        v = j.get(k)
        if v:
            try:
                return dt.date.fromisoformat(v[:10])
            except ValueError:
                pass
    return today()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="只跑這些來源，例如 104 ptt")
    ap.add_argument("--config", default=os.path.join(ROOT, "config.yaml"))
    args = ap.parse_args(argv)

    cfg = yaml.safe_load(open(args.config, encoding="utf-8"))
    rules = Rules(cfg)
    http = Http(cfg)
    db = load_json(JOBS, {"jobs": []})
    existing = db.get("jobs", [])
    # 改了設定檔後，舊的自動抓取職缺也重新套用排除／地區規則（初始人工整理的 seed 資料不動）
    before = len(existing)
    existing = [j for j in existing if j.get("seed") or (
        not rules.excluded(j.get("title", ""), j.get("company", "")) and rules.location_ok(j.get("location", ""), j.get("remote"), j.get("onsiteDays", "")))]
    refiltered = before - len(existing)
    by_url = {j["url"]: j for j in existing}
    tc_keys = {key_tc(j) for j in existing}
    known = set(by_url)
    now = today().isoformat()
    keep_days = int(cfg.get("keep_days", 45))
    cutoff = today() - dt.timedelta(days=keep_days)

    stats, new_jobs = {}, []
    for sid, mod in SOURCES.items():
        sc = cfg["sources"].get(sid, {})
        if args.only and sid not in args.only:
            continue
        if not sc.get("enabled", True):
            stats[mod.NAME] = {"status": "已停用"}
            continue
        t0, req0 = time.time(), http.count
        st = {"status": "成功", "fetched": 0, "kept": 0, "new": 0, "errors": []}
        try:
            raw, errs = mod.fetch(http, cfg, rules, known)
            st["errors"] = errs[:10]
            st["fetched"] = len(raw)
            for r in raw:
                desc = r.pop("_desc", "")
                j = rules.finalize(r)
                if not j or not j.get("url"):
                    continue
                if ref_date(j) < cutoff:
                    continue
                st["kept"] += 1
                if j["url"] in by_url:  # 已存在：只更新日期與最後看到時間，保留人工整理過的欄位
                    old = by_url[j["url"]]
                    if j.get("date"):
                        old["date"] = j["date"]
                    if j.get("dateText"):
                        old["dateText"] = j["dateText"]
                    old["lastSeen"] = now
                    continue
                k = key_tc(j)
                if k in tc_keys:  # 同標題＋同公司視為重複
                    continue
                j["firstSeen"] = now
                j["lastSeen"] = now
                by_url[j["url"]] = j
                tc_keys.add(k)
                st["new"] += 1
                new_jobs.append(dict(j, description=desc))
            if errs and not raw:
                st["status"] = "失敗"
            elif errs:
                st["status"] = "部分成功"
        except Exception as e:  # 一個來源壞掉不影響其他來源
            st["status"] = "失敗"
            st["errors"].append(f"{type(e).__name__}: {e}")
            traceback.print_exc()
        st["requests"] = http.count - req0
        st["seconds"] = round(time.time() - t0, 1)
        stats[mod.NAME] = st
        print(f"[{mod.NAME}] {st['status']} 抓到 {st['fetched']}、符合 {st['kept']}、新增 {st['new']}"
              + (f"、錯誤 {len(st['errors'])}（{st['errors'][0][:120]}）" if st["errors"] else ""), flush=True)

    jobs = [j for j in by_url.values() if ref_date(j) >= cutoff]
    removed = len(by_url) - len(jobs)
    jobs.sort(key=lambda j: (j.get("date") or j.get("firstSeen") or ""), reverse=True)
    stamp = dt.datetime.now(TZ).isoformat(timespec="seconds")
    os.makedirs(os.path.dirname(JOBS), exist_ok=True)
    with open(JOBS, "w", encoding="utf-8") as f:
        json.dump({"updated": stamp, "jobs": jobs}, f, ensure_ascii=False, indent=1)
    meta = {"lastRun": stamp, "total": len(jobs), "newThisRun": len(new_jobs), "removedOld": removed, "removedByRules": refiltered,
            "keepDays": keep_days, "sources": stats}
    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, "new_jobs.json"), "w", encoding="utf-8") as f:
        json.dump(new_jobs, f, ensure_ascii=False, indent=1)
    print(f"完成：共 {len(jobs)} 筆（本次新增 {len(new_jobs)}、移除過期 {removed}）")
    # 全部來源都失敗才回傳錯誤碼（保留上次資料，不會被清空）
    ok = [s for s in stats.values() if s.get("status") in ("成功", "部分成功")]
    return 0 if ok or not stats else 1


if __name__ == "__main__":
    sys.exit(main())
