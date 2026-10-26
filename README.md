# Anya 的職缺追蹤（自動更新版）

這是一套**不需要任何 AI 也能運作**的職缺追蹤系統：

- 每天早上 9:00（台北時間）由 GitHub 免費的自動化服務（GitHub Actions）去公開職缺網站抓資料。
- 依照 `config.yaml` 的規則篩選（地區、排除服務業／業務／資深職等）、去除重複、只保留 45 天內的職缺。
- 結果存成 `docs/data/jobs.json`，並顯示在一個免費的網站（GitHub Pages）上，可搜尋、篩選、排序。
- 你可以在網站上 ★ 收藏、寫備註、標記狀態（想投／已投／面試／不考慮）。這些資料存在你自己的瀏覽器裡，可以匯出／匯入 JSON 備份。若依照下方「跨裝置同步」設定 Supabase，登入後同一份進度也會出現在手機與電腦。
- 「公司與工作室探索」分頁列出值得留意的公司與工作室（`docs/data/companies.json`）。
- **（選用）** 如果你有任何 AI 服務的金鑰，可以讓 AI 幫新職缺重新分類、判斷適合度、寫一句話備註。沒有金鑰就自動跳過。

一開始已經放入 153 筆先前整理好的職缺與 39 間公司／工作室，另外在測試時實際抓了一次（共 600 筆）。

---

## 資料來源

| 來源 | 抓什麼 | 備註 |
|---|---|---|
| 104 人力銀行 | 約 30 個關鍵字，台北／新北，另搜尋遠端職缺 | 會讀職缺內頁補上工作天數、遠端說明 |
| 518 熊班 | 14 個關鍵字 | 結果較雜，靠規則篩掉服務業 |
| PTT HomeTeach、PTT part-time | 最新幾頁貼文 | 非正式貼文，未經查證，請自行判斷 |
| Yourator | 關鍵字搜尋，只留入門／實習 | 日期是「幾天前活躍」，沒有確切日期 |
| LinkedIn（免登入的公開頁） | 13 個關鍵字，入門／實習 | |
| 1111 家教網 | 台北／新北家教與伴讀案件 | |

每個來源互相獨立：某一個網站壞掉或擋住，其他來源照常更新；全部失敗時保留上次的資料，不會清空。
每次執行的結果（成功／部分成功／失敗、抓到幾筆、新增幾筆）會寫在 `docs/data/meta.json`，網站的「資料來源與說明」分頁也看得到。

---

## 檔案說明

```
config.yaml                 ← 關鍵字與篩選規則（你最常改的檔案）
requirements.txt            ← Python 套件清單
scraper/run.py              ← 主程式：抓取、篩選、去重、保留 45 天
scraper/common.py           ← 共用工具與規則判斷
scraper/sources/*.py        ← 每個網站一個檔案
scraper/ai_filter.py        ← （選用）AI 篩選
docs/index.html, app.js, style.css  ← 網站
docs/config.js              ← （選用）Supabase 網址與 anon key；留空就只用本機
docs/data/jobs.json         ← 職缺資料（自動更新）
docs/data/companies.json    ← 公司與工作室名單（手動維護）
docs/data/meta.json         ← 最近一次執行紀錄
.github/workflows/update.yml← 每天自動執行的設定
supabase/schema.sql         ← （選用）雲端同步的資料表與權限
tools/seed_from_canvas.js   ← 產生初始資料用的小工具（平常用不到）
```

---

## 架設步驟（不需要會寫程式）

### 1. 註冊 GitHub 帳號
到 <https://github.com/signup> 註冊免費帳號。

### 2. 建立一個新的 repository（專案）
1. 登入後，右上角「+」→「New repository」。
2. Repository name 填 `job-tracker`（或任何英文名字）。
3. 選 **Public**（免費帳號的 GitHub Pages 需要公開 repo；職缺資料本來就是公開資訊。收藏與備註不會進到這個 GitHub 專案；只有另外設定 Supabase 並登入之後，才會存到你自己的 Supabase）。
4. 按「Create repository」。

### 3. 上傳檔案
1. 把 `job-tracker.zip` 解壓縮。
2. 在新 repo 的頁面點「uploading an existing file」（或「Add file」→「Upload files」）。
3. 把解壓縮後資料夾**裡面的所有檔案與資料夾**拖進去（不是拖整個外層資料夾）。
4. 下方按「Commit changes」。

> ⚠️ `.github` 資料夾是隱藏資料夾，有些電腦預設看不到。
> - Mac：在 Finder 按 `Cmd + Shift + .` 顯示隱藏檔。
> - Windows：檔案總管 →「檢視」→ 勾選「隱藏的項目」。
>
> 如果拖不進去，也可以在 GitHub 上「Add file」→「Create new file」，檔名輸入 `.github/workflows/update.yml`，再把檔案內容貼上。

### 4. 開啟網站（GitHub Pages）
1. repo 頁面上方「Settings」→ 左側「Pages」。
2. 「Source」選 **Deploy from a branch**。
3. Branch 選 `main`，資料夾選 **/docs**，按「Save」。
4. 等 1～2 分鐘，頁面上方會出現網址，例如 `https://你的帳號.github.io/job-tracker/`。

### 5. 允許自動更新寫入資料
「Settings」→「Actions」→「General」→ 最下面「Workflow permissions」選 **Read and write permissions** → Save。
（設定檔裡已經寫了 `contents: write`，但有些帳號預設仍需要開這個。）

### 6. （選用）設定 AI 金鑰
沒有要用 AI 可以跳過，系統照樣每天更新。
「Settings」→「Secrets and variables」→「Actions」→「New repository secret」，依序新增：

| Name | Value |
|---|---|
| `AI_API_KEY` | 你的金鑰 |
| `AI_BASE_URL` | 服務網址（見下方表格；用 OpenAI 可不填） |
| `AI_MODEL` | 模型名稱（見下方表格；用 OpenAI 可不填，預設 gpt-4o-mini） |

### 7. 手動執行第一次
1. repo 上方「Actions」分頁。如果看到提示要啟用 workflow，按綠色按鈕啟用。
2. 左側點「每日更新職缺」→ 右側「Run workflow」→「Run workflow」。
3. 大約 5～10 分鐘後完成（綠色勾勾）。重新整理你的網站就會看到最新資料。
4. 之後每天台北時間早上 9:00 會自動執行。

> 補充：GitHub 規定，如果 repo 連續 60 天沒有任何活動，排程會自動暫停，到 Actions 頁面重新啟用即可。

---

## 如何修改關鍵字與篩選規則

直接在 GitHub 網頁上打開 `config.yaml` → 右上角鉛筆圖示（Edit）→ 修改 → 「Commit changes」。下次執行就會套用。

常改的地方：

- `sources` → `"104"` → `keywords`：104 的搜尋關鍵字，一行一個，前面是 `- `。518、LinkedIn、Yourator 也各有自己的 `keywords`。
- `locations` → `include`：地點要包含哪些字才保留（例如 台北、新北、遠端）。
- `exclude` → `service_keywords`：職稱或公司名稱含這些字就排除（餐飲、門市等）。
- `exclude` → `other_keywords`：其他想排除的字（工程師、業務等）。
- `exclude` → `max_experience_years`：要求超過幾年經驗就排除。
- `categories`：四個類別各自的判斷關鍵字，**由上到下第一個符合的就是它的類別**。
- `keep_days`：保留幾天內的職缺（預設 45）。
- `ai` → `profile`：給 AI 看的求職條件說明。

注意 YAML 格式：縮排要用空白（不要用 Tab），冒號後面要空一格。改壞了 Actions 會顯示紅色叉叉，把檔案改回來即可。

---

## 如何更換 AI 服務

`scraper/ai_filter.py` 使用通用的「OpenAI 相容」介面，只要改三個 secret 就能換服務，程式不用動：

| 服務 | AI_BASE_URL | AI_MODEL（範例） |
|---|---|---|
| OpenAI | `https://api.openai.com/v1`（可不填） | `gpt-4o-mini` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` 等 |
| Ollama（自己電腦） | `http://localhost:11434/v1` | `qwen2.5:7b` 等；金鑰隨便填，例如 `ollama` |

模型名稱各家會更新，請以各服務官網的最新清單為準。
Ollama 跑在你自己的電腦上，GitHub 的主機連不到，所以只能在自己電腦手動執行（見下方「在自己電腦執行」）。

想完全停用 AI：刪除 `AI_API_KEY` 這個 secret 即可。

AI 只會做三件事：重新分類、判斷適合度（高／中／低）、寫一句話備註。網站上會多出「AI 適合度」篩選。
預設**不會**刪除任何職缺；如果想讓 AI 自動移除「低」適合度的職缺，把 `config.yaml` 的 `ai.drop_low_fit` 改成 `true`。

---

## 費用與 token 用量估算

- **GitHub 帳號、Actions、Pages：免費**（公開 repo 的 Actions 不計分鐘數）。
- **不用 AI：完全免費。**
- **用 AI：** 只處理「這次新出現」的職缺，每批 15 筆，每筆只送職稱、公司、地點、薪資與 160 字內的說明，每次最多 150 筆。

在本機用實際資料試算（`python -m scraper.ai_filter --dry-run`）：

| 情境 | 新職缺數 | 輸入 tokens | 輸出 tokens |
|---|---|---|---|
| 第一次執行（達上限） | 150 | 約 24,400 | 約 4,500 |
| 平常每天（估計） | 20～60 | 約 3,500～10,000 | 約 600～1,800 |

以 gpt-4o-mini 的價格（約每百萬輸入 tokens US$0.15、輸出 US$0.60，請以官方最新價格為準）計算，第一次約 US$0.007，平常每天不到 US$0.005，**一個月大約 US$0.1～0.2（約新台幣 3～6 元）**。Gemini、Groq 等服務常有免費額度，可能完全不用錢。

---

## 在自己電腦執行（選用）

需要先安裝 Python 3.10 以上。

```bash
pip install -r requirements.txt
python -m scraper.run                 # 抓全部來源
python -m scraper.run --only 104 ptt  # 只抓某些來源（代號：104 518 ptt yourator linkedin tutor1111）
python -m scraper.ai_filter --dry-run # 只估算 AI token，不呼叫
python -m scraper.ai_filter           # 有設定 AI_API_KEY 環境變數才會執行
cd docs && python -m http.server 8000 # 然後打開 http://localhost:8000
```

在台灣的電腦執行，比 GitHub 的國外主機更不容易被網站擋。執行完可以把 `docs/data/jobs.json` 與 `meta.json` 上傳到 GitHub 覆蓋。

---

## 跨裝置同步（選用，Supabase 免費額度）

沒做這一段也完全沒問題：`docs/config.js` 的兩個值留空時，網站跟以前一樣，收藏、狀態、備註只存在這台裝置的瀏覽器。

做完之後，用同一個電子郵件登入，手機和電腦會看到同一份進度。網站仍是純靜態檔案，不需要建置；登入用電子郵件裡的連結或驗證碼，**網站不會保存密碼**。

1. 到 <https://supabase.com> 註冊，新建一個專案，方案選 **Free**。資料庫密碼自己保管即可，網站用不到。
2. 等專案建好。左側 **SQL Editor** → **New query**，打開本專案的 `supabase/schema.sql`，整份貼上，按 **Run**。看到成功即可。
3. 左側 **Authentication** → **URL Configuration**：
   - **Site URL** 填網站網址，而且**一定要包含 `https://`**，例如 `https://你的專案.vercel.app`（Vercel 的根目錄是 `docs`、沒有建置步驟）。不要只填網域。少了 `https://` 時，點登入信會被帶到 Supabase 的網址，而不是這個網站。
   - **Redirect URLs** 加上同一個網址。建議這三個都加：`https://你的專案.vercel.app`、`https://你的專案.vercel.app/`、`https://你的專案.vercel.app/**`。
   - 若會在自己電腦試：再加 `http://localhost:8000/**`。
4. 確認 **Authentication** → **Sign In / Providers** → **Email** 是開啟的。不用設定密碼。
5. 左側 **Project Settings** → **API Keys**（有些畫面叫 **API**）：
   - 複製 **Project URL**。
   - 複製 **anon public** key，或新的 **publishable** key（`sb_publishable_` 開頭）。
   - **不要**複製 `service_role` 或 secret key。那種金鑰可以繞過權限，不能放進網站。
6. 打開 `docs/config.js`，把網址填進 `url`，金鑰填進 `anonKey`，存檔並部署。兩個都留空就會關閉同步。
7. 重新整理網站，標題下方會出現「登入」。**不用改 Supabase 的信件範本**（免費方案用內建寄信時，範本通常也不能改）。
   - 輸入電子郵件 → **寄送登入連結**。到信箱打開那封預設的信，點裡面的連結。**哪一台裝置打開，就登入那一台**（手機開就登入手機）。連結只能用一次，請盡快點開。
   - 登入之後按 **設定密碼**（至少 6 個字）。其他手機或電腦用同一個電子郵件和密碼登入，不用再收信。
   - 網站不會保存密碼，只把密碼交給 Supabase 登入。
   - 若信裡剛好有 6 位數驗證碼，也可以輸入；預設的信沒有這組數字，不影響登入。
8. 第一次登入會把這台裝置已經有的收藏、狀態、備註和雲端合併：只有一邊有的職缺會保留。兩邊都改過同一筆時，以比較新的那次為準；這台裝置上還沒同步過的舊收藏或備註，不會因為雲端那一欄是空的就被清掉。之後的修改會自動存到雲端，也會留在這台瀏覽器，沒有網路時仍可看、可改，恢復連線後會再同步。
9. 「匯出／匯入 JSON」維持可用。換瀏覽器或清掉網站資料前，仍建議匯出一份備份。

這組 anon / publishable key 會出現在公開網頁上，這是預期的。資料表開了 Row Level Security：沒登入的人讀不到，登入之後也只能讀寫自己的列。免費額度對這種個人小量資料足夠。

---

## 限制與注意事項

- **GitHub 主機在國外**：Actions 的主機 IP 在美國／歐洲，部分台灣網站可能會限制或擋掉國外 IP。如果某來源在 `meta.json` 一直顯示「失敗」，可以改在自己電腦執行，或在 `config.yaml` 把該來源的 `enabled` 改成 `false`。
- **網站改版**：爬蟲依賴各網站目前的網頁結構與公開介面，網站改版後某個來源可能失效，需要修改對應的 `scraper/sources/*.py`。
- **不支援 Facebook**：Facebook 社團需要登入才能看，本系統只讀公開頁面、不登入任何帳號。
- **不支援 1111 人力銀行主站、Cake、Dcard**：這些網站有機器人檢查或封鎖自動讀取（只有 1111 家教網可用）。
- **日期意義不同**：104 的日期是「職缺更新日」，不一定是首次刊登日；Yourator 只有「幾天前活躍」，沒有確切日期（改用首次抓到日計算 45 天）；518 只有月／日，年份由程式推算。
- **規則篩選不完美**：104、518 結果較廣，難免混入不太相關的職缺；可以調整 `config.yaml`，或開啟 AI 篩選。
- **PTT、1111 家教網是非正式貼文**，未經查證，應徵前請自行確認對方身分，不要先付任何費用。
- **沒有設定 Supabase 時，收藏、狀態、備註只存在目前這台裝置的瀏覽器**。有設定並登入之後，會在你的裝置之間同步，這台裝置仍留一份離線備份。換電腦或清除瀏覽器資料前，請先用網站上的「匯出」備份。
- 請合理使用：程式每次請求間隔約 1.2 秒、每天只跑一次，請不要大幅提高頻率。
