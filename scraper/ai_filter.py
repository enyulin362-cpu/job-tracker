"""（選用）AI 篩選：只對本次新抓到的職缺做分類、適合度判斷與一句話備註。

使用任何「OpenAI 相容」的 Chat Completions API：
  AI_API_KEY   金鑰（沒設定就自動跳過；Ollama 本機可填任意字，例如 ollama）
  AI_BASE_URL  例如 https://api.openai.com/v1（預設）
  AI_MODEL     例如 gpt-4o-mini（預設）

用法： python -m scraper.ai_filter            # 實際呼叫
       python -m scraper.ai_filter --dry-run  # 不呼叫，只估算 token
"""
import argparse
import json
import os
import re
import sys

import requests
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBS = os.path.join(ROOT, "docs", "data", "jobs.json")
NEW = os.path.join(ROOT, "scraper", ".cache", "new_jobs.json")
META = os.path.join(ROOT, "docs", "data", "meta.json")

SYSTEM = """你是職缺篩選助理。根據求職者條件，判斷每筆職缺。
類別只能是：設計與生涯、藝術與諮詢、一般工讀、家教伴讀、不相關。
適合度只能是：高、中、低。
備註用繁體中文一句話（20 字內），說明為什麼適合或不適合。
只輸出 JSON 陣列，不要其他文字，格式：[{"i":編號,"c":"類別","f":"適合度","n":"備註"}]
求職者條件：{profile}"""


def est_tokens(text):
    """粗估 token：中日韓字約 1 字 1 token，其他約 4 字元 1 token。"""
    cjk = len(re.findall(r"[\u3000-\u9fff\uff00-\uffef]", text))
    return int(cjk + (len(text) - cjk) / 4) + 1


def compact(i, j, n):
    desc = re.sub(r"\s+", " ", j.get("description", ""))[:n]
    parts = [str(i), j.get("title", ""), j.get("company", ""), j.get("location", ""), j.get("type", ""), j.get("salary", ""), desc]
    return "|".join(p for p in parts if p and p != "未提供")


def call(base, key, model, system, user):
    r = requests.post(
        base.rstrip("/") + "/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": model, "temperature": 0, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    text = data["choices"][0]["message"]["content"] or ""
    m = re.search(r"\[.*\]", text, re.S)
    return (json.loads(m.group(0)) if m else []), data.get("usage", {})


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    cfg = yaml.safe_load(open(os.path.join(ROOT, "config.yaml"), encoding="utf-8")).get("ai", {})
    key = os.environ.get("AI_API_KEY", "").strip()
    base = os.environ.get("AI_BASE_URL", "").strip() or "https://api.openai.com/v1"
    model = os.environ.get("AI_MODEL", "").strip() or "gpt-4o-mini"
    if not key and not args.dry_run:
        print("未設定 AI_API_KEY，跳過 AI 篩選（這是正常的，網站仍會使用規則篩選的結果）。")
        return 0
    try:
        new = json.load(open(NEW, encoding="utf-8"))
    except FileNotFoundError:
        print("找不到本次新職缺清單，請先執行 python -m scraper.run")
        return 0
    new = new[: int(cfg.get("max_jobs_per_run", 150))]
    if not new:
        print("本次沒有新職缺，不需要 AI。")
        return 0
    system = SYSTEM.replace("{profile}", cfg.get("profile", ""))
    bs, n = int(cfg.get("batch_size", 15)), int(cfg.get("desc_chars", 160))
    batches = [new[k:k + bs] for k in range(0, len(new), bs)]
    est_in = sum(est_tokens(system) + est_tokens("\n".join(compact(i, j, n) for i, j in enumerate(b))) for b in batches)
    est_out = 30 * len(new)
    print(f"新職缺 {len(new)} 筆，分 {len(batches)} 批；預估輸入約 {est_in:,} tokens、輸出約 {est_out:,} tokens")
    if args.dry_run:
        return 0

    db = json.load(open(JOBS, encoding="utf-8"))
    by_url = {j["url"]: j for j in db["jobs"]}
    used = {"prompt_tokens": 0, "completion_tokens": 0}
    done, drop = 0, set()
    for b in batches:
        user = "\n".join(compact(i, j, n) for i, j in enumerate(b))
        try:
            res, usage = call(base, key, model, system, user)
        except Exception as e:  # 一批失敗就跳過，不影響資料
            print(f"AI 呼叫失敗（略過這批）：{e}")
            continue
        for k in used:
            used[k] += int(usage.get(k, 0) or 0)
        for r in res:
            try:
                j = by_url.get(b[int(r["i"])]["url"])
            except (KeyError, IndexError, ValueError, TypeError):
                continue
            if not j:
                continue
            c, f, note = r.get("c", ""), r.get("f", ""), str(r.get("n", ""))[:40]
            if c in ("設計與生涯", "藝術與諮詢", "一般工讀", "家教伴讀"):
                j["category"] = c
            if f in ("高", "中", "低"):
                j["aiFit"] = f
            if c == "不相關":
                j["aiFit"] = "低"
            if note:
                j["fitNote"] = note
            if cfg.get("drop_low_fit") and j.get("aiFit") == "低":
                drop.add(j["url"])
            done += 1
    if drop:
        db["jobs"] = [j for j in db["jobs"] if j["url"] not in drop]
    with open(JOBS, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=1)
    try:
        meta = json.load(open(META, encoding="utf-8"))
        meta["ai"] = {"model": model, "processed": done, "dropped": len(drop), **used}
        json.dump(meta, open(META, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    except FileNotFoundError:
        pass
    print(f"AI 完成：處理 {done} 筆、移除 {len(drop)} 筆；實際用量 輸入 {used['prompt_tokens']:,}、輸出 {used['completion_tokens']:,} tokens")
    return 0


if __name__ == "__main__":
    sys.exit(main())
