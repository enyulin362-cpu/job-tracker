/* Anya 的職缺追蹤 — 純前端，無需建置。
   收藏／狀態／備註存在 localStorage（jerry-job-tracker-v1）。
   docs/config.js 的 Supabase 網址與 anon key 都留空時，行為與只用本機儲存相同。 */
(function () {
  "use strict";
  var STORE_KEY = "jerry-job-tracker-v1";
  var PAGE = 60;
  var STATUSES = ["想投", "已投", "面試", "不考慮"];
  var CAT_ORDER = ["設計與生涯", "藝術與諮詢", "一般工讀", "家教伴讀"];
  var USER_MAPS = ["fav", "status", "note", "favJobs", "updated"];

  // ---------- 純函式（可在 node 測試） ----------
  function norm(s) { return String(s == null ? "" : s).toLowerCase(); }
  function hasDays(j) { return !!j.workDays && j.workDays !== "未提供"; }
  function daysAgo(iso, today) {
    if (!iso) return Infinity;
    var t = Date.parse(String(iso).slice(0, 10));
    return isNaN(t) ? Infinity : (today - t) / 86400000;
  }
  function payNumber(s) {
    // 換算成約略時薪，方便排序：月薪 / 176、日薪 / 8、年薪 / 2112
    s = String(s || "");
    var m = s.replace(/,/g, "").match(/\d{2,7}/);
    if (!m || /論件|面議/.test(s)) return -1;
    var n = +m[0];
    if (/月薪/.test(s)) return n / 176;
    if (/日薪/.test(s)) return n / 8;
    if (/年薪/.test(s) || n > 300000) return n / 2112;
    if (n > 20000) return n / 176;
    return n;
  }
  function filterJobs(jobs, f, user, today) {
    var q = norm(f.q).trim().split(/\s+/).filter(Boolean);
    return jobs.filter(function (j) {
      var st = (user.status || {})[j.url] || "";
      if (f.cat && j.category !== f.cat) return false;
      if (f.src && j.source !== f.src) return false;
      if (f.remote && !j.remote) return false;
      if (f.intern && !j.intern) return false;
      if (f.days && !hasDays(j)) return false;
      if (f.fit && j.aiFit !== f.fit) return false;
      if (f.sal && norm(j.salary).indexOf(norm(f.sal)) < 0) return false;
      if (f.isNew && daysAgo(j.firstSeen, today) > 7) return false;
      if (f.status === "__none" ? !!st : f.status && st !== f.status) return false;
      if (f.hideNo && st === "不考慮") return false;
      if (q.length) {
        var hay = norm([j.title, j.company, j.location, j.salary, j.type, j.fitNote, j.workDays, j.onsiteDays, (user.note || {})[j.url]].join(" "));
        for (var i = 0; i < q.length; i++) if (hay.indexOf(q[i]) < 0) return false;
      }
      return true;
    });
  }
  function sortJobs(list, key) {
    var a = list.slice();
    var by = {
      date: function (x, y) { return String(y.date || y.firstSeen || "").localeCompare(String(x.date || x.firstSeen || "")); },
      first: function (x, y) { return String(y.firstSeen || "").localeCompare(String(x.firstSeen || "")); },
      company: function (x, y) { return String(x.company).localeCompare(String(y.company), "zh-Hant"); },
      title: function (x, y) { return String(x.title).localeCompare(String(y.title), "zh-Hant"); },
      pay: function (x, y) { return payNumber(y.salary) - payNumber(x.salary); }
    }[key] || function () { return 0; };
    return a.sort(by);
  }
  function emptyUser() {
    return { fav: {}, status: {}, note: {}, favJobs: {}, updated: {} };
  }
  function assignMap(target, src) {
    if (!src || typeof src !== "object") return;
    Object.keys(src).forEach(function (id) {
      if (!id || id === "__proto__" || id === "constructor" || id === "prototype") return;
      target[id] = src[id];
    });
  }
  function mergeUser(base, inc) {
    var out = emptyUser();
    USER_MAPS.forEach(function (k) {
      assignMap(out[k], base && base[k]);
      assignMap(out[k], inc && inc[k]);
    });
    return out;
  }
  function normalizeSupabaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }
  function decodeJwtPayload(key) {
    var parts = String(key || "").split(".");
    if (parts.length < 2 || !parts[1]) return null;
    var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    try {
      var raw;
      if (typeof atob === "function") raw = atob(b64);
      else if (typeof Buffer !== "undefined") raw = Buffer.from(b64, "base64").toString("utf8");
      else return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function looksLikeServiceRole(key) {
    var k = String(key || "").trim();
    // 新的 secret key 不是 JWT，但權限等同 service_role，不能放進公開網站。
    if (/^sb_secret_/i.test(k)) return true;
    var payload = decodeJwtPayload(k);
    return !!(payload && payload.role === "service_role");
  }
  function supabaseConfigError(cfg) {
    if (!cfg || typeof cfg !== "object") return "";
    var url = normalizeSupabaseUrl(cfg.url);
    var key = String(cfg.anonKey == null ? "" : cfg.anonKey).trim();
    if (!url && !key) return "";
    if (!url || !key) return "同步設定不完整，目前只存在這台裝置";
    if (!/^https:\/\/[^\s/]+$/i.test(url)) return "同步網址需要是 https，目前只存在這台裝置";
    if (looksLikeServiceRole(key)) return "請改填 anon 或 publishable key，不要填 service_role 或 secret key";
    return "";
  }
  function isSupabaseConfigured(cfg) {
    return !!(cfg && typeof cfg === "object" && !supabaseConfigError(cfg) &&
      normalizeSupabaseUrl(cfg.url) && String(cfg.anonKey || "").trim());
  }
  function timeMs(iso) {
    var t = Date.parse(iso || "");
    return isNaN(t) ? 0 : t;
  }
  function cleanStatus(s) {
    return STATUSES.indexOf(s) >= 0 ? s : "";
  }
  function stableJson(v) {
    if (v == null || typeof v !== "object") return JSON.stringify(v == null ? null : v);
    if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ":" + stableJson(v[k]);
    }).join(",") + "}";
  }
  function blank(v) { return v == null || v === "" || v === false; }
  // 同一個欄位：兩邊都有值時，時間較新的贏（平手用本機）。
  // 空白只有在「兩邊都有時間、而且空白那一邊比較新」時才算明確清除。
  // 沒有時間的舊資料不會被另一邊的空白清掉，避免第一次登入弄丟收藏。
  function pickField(localVal, remoteVal, lt, rt) {
    var le = blank(localVal), re = blank(remoteVal);
    if (le && re) return localVal === false || remoteVal === false ? false : "";
    if (!le && re) return rt > lt && lt > 0 ? remoteVal : localVal;
    if (le && !re) return lt > rt && rt > 0 ? localVal : remoteVal;
    return rt > lt ? remoteVal : localVal;
  }
  function readJob(user, id) {
    var fav = !!(user.fav && user.fav[id]);
    var status = cleanStatus((user.status && user.status[id]) || "");
    var note = user.note && user.note[id] != null ? String(user.note[id]) : "";
    if (note.length > 20000) note = note.slice(0, 20000);
    var updatedAt = user.updated && typeof user.updated[id] === "string" ? user.updated[id] : "";
    var snap = user.favJobs && user.favJobs[id];
    var favJob = fav && snap && typeof snap === "object" && !Array.isArray(snap) ? snap : null;
    if (!fav && !status && !note && !updatedAt) return null;
    return { fav: fav, status: status, note: note, favJob: favJob, updatedAt: updatedAt };
  }
  function jobContent(rec) {
    return {
      fav: !!rec.fav,
      status: rec.status || "",
      note: rec.note || "",
      favJob: rec.fav ? (rec.favJob || null) : null
    };
  }
  function sameContent(a, b) {
    return a.fav === b.fav && a.status === b.status && a.note === b.note && stableJson(a.favJob) === stableJson(b.favJob);
  }
  function chooseUpdatedAt(localRec, remoteRec, merged, lt, rt, nowIso) {
    var mc = jobContent(merged), lc = jobContent(localRec), rc = jobContent(remoteRec);
    var sameL = sameContent(mc, lc), sameR = sameContent(mc, rc);
    if (sameL && sameR) {
      if (rt > lt && remoteRec.updatedAt) return remoteRec.updatedAt;
      return localRec.updatedAt || remoteRec.updatedAt || nowIso;
    }
    if (sameR && rt > 0 && remoteRec.updatedAt) return remoteRec.updatedAt;
    if (sameL && lt > 0 && localRec.updatedAt) return localRec.updatedAt;
    return nowIso;
  }
  function mergeOne(localRec, remoteRec, nowIso) {
    if (!localRec && !remoteRec) return null;
    if (!localRec) return remoteRec.updatedAt ? remoteRec : Object.assign({}, remoteRec, { updatedAt: nowIso });
    if (!remoteRec) return localRec.updatedAt ? localRec : Object.assign({}, localRec, { updatedAt: nowIso });
    var lt = timeMs(localRec.updatedAt), rt = timeMs(remoteRec.updatedAt);
    var fav = !!pickField(!!localRec.fav, !!remoteRec.fav, lt, rt);
    var status = pickField(localRec.status || "", remoteRec.status || "", lt, rt) || "";
    var note = pickField(localRec.note || "", remoteRec.note || "", lt, rt) || "";
    var favJob = null;
    if (fav) {
      var ls = localRec.fav ? (localRec.favJob || null) : null;
      var rs = remoteRec.fav ? (remoteRec.favJob || null) : null;
      favJob = ls && rs ? (rt > lt ? rs : ls) : (ls || rs);
    }
    var merged = { fav: fav, status: status, note: note, favJob: favJob, updatedAt: "" };
    merged.updatedAt = chooseUpdatedAt(localRec, remoteRec, merged, lt, rt, nowIso);
    return merged;
  }
  function jobIdList(user) {
    var seen = {};
    USER_MAPS.forEach(function (k) {
      var src = user && user[k];
      if (!src || typeof src !== "object") return;
      Object.keys(src).forEach(function (id) { if (id) seen[id] = 1; });
    });
    return Object.keys(seen);
  }
  function writeJob(user, id, rec) {
    if (!rec) return;
    if (rec.fav) user.fav[id] = true;
    if (rec.status) user.status[id] = rec.status;
    if (rec.note) user.note[id] = rec.note;
    if (rec.fav && rec.favJob) user.favJobs[id] = rec.favJob;
    if (rec.updatedAt) user.updated[id] = rec.updatedAt;
  }
  function mergeProgress(localRaw, remoteRaw, nowIso) {
    var local = mergeUser(localRaw, null);
    var remote = mergeUser(remoteRaw, null);
    var out = emptyUser();
    var ids = {};
    jobIdList(local).concat(jobIdList(remote)).forEach(function (id) { ids[id] = 1; });
    Object.keys(ids).forEach(function (id) {
      writeJob(out, id, mergeOne(readJob(local, id), readJob(remote, id), nowIso));
    });
    return out;
  }
  function rowsFromUser(user) {
    var src = mergeUser(user, null);
    var rows = [];
    jobIdList(src).forEach(function (id) {
      var rec = readJob(src, id);
      if (!rec) return;
      rows.push({
        job_id: id,
        favorite: !!rec.fav,
        status: rec.status || null,
        note: rec.note || null,
        fav_snapshot: rec.fav ? (rec.favJob || null) : null,
        updated_at: rec.updatedAt || new Date(0).toISOString()
      });
    });
    return rows;
  }
  function userFromRows(rows) {
    var user = emptyUser();
    (rows || []).forEach(function (row) {
      if (!row || !row.job_id) return;
      var id = String(row.job_id);
      if (row.favorite) user.fav[id] = true;
      var status = cleanStatus(row.status || "");
      if (status) user.status[id] = status;
      if (row.note) user.note[id] = String(row.note).slice(0, 20000);
      if (row.favorite && row.fav_snapshot && typeof row.fav_snapshot === "object" && !Array.isArray(row.fav_snapshot)) {
        user.favJobs[id] = row.fav_snapshot;
      }
      if (row.updated_at) user.updated[id] = row.updated_at;
    });
    return user;
  }
  function sameRow(row, remote) {
    if (!row || !remote) return false;
    var ta = timeMs(row.updated_at), tb = timeMs(remote.updated_at);
    return !!row.favorite === !!remote.favorite &&
      (row.status || "") === (remote.status || "") &&
      (row.note || "") === (remote.note || "") &&
      ta > 0 && ta === tb &&
      stableJson(row.fav_snapshot || null) === stableJson(remote.fav_snapshot || null);
  }
  function applyImport(localUser, inc, nowIso) {
    var merged = mergeUser(localUser, inc);
    ["fav", "status", "note", "favJobs"].forEach(function (k) {
      Object.keys((inc && inc[k]) || {}).forEach(function (id) {
        if (id && id !== "__proto__" && id !== "constructor" && id !== "prototype") merged.updated[id] = nowIso;
      });
    });
    return merged;
  }
  var OTP_TYPES = ["email", "signup", "magiclink"];
  function otpTypesToTry(explicitType) {
    var type = String(explicitType || "").trim().toLowerCase();
    var order = OTP_TYPES.slice();
    if (type && order.indexOf(type) < 0 && /^[a-z0-9_]+$/.test(type)) order.unshift(type);
    else if (order.indexOf(type) > 0) order = [type].concat(order.filter(function (t) { return t !== type; }));
    return order;
  }
  function parseAuthCallback(href) {
    var empty = { tokenHash: "", type: "", code: "", error: "", accessToken: "", refreshToken: "" };
    var url;
    try { url = new URL(String(href || ""), "https://job-tracker-docs.vercel.app"); }
    catch (e) { return empty; }
    var query = url.searchParams;
    var hash = new URLSearchParams((url.hash || "").replace(/^#/, ""));
    function pick(name) { return query.get(name) || hash.get(name) || ""; }
    return {
      tokenHash: pick("token_hash"),
      type: pick("type"),
      code: pick("code"),
      error: pick("error_description") || pick("error") || "",
      accessToken: pick("access_token"),
      refreshToken: pick("refresh_token")
    };
  }
  function stripAuthParams(href) {
    var url = new URL(String(href || ""), "https://job-tracker-docs.vercel.app");
    var keys = ["token_hash", "type", "code", "error", "error_description", "error_code", "access_token", "refresh_token", "expires_in", "expires_at", "token_type", "provider_token", "sb"];
    keys.forEach(function (k) { url.searchParams.delete(k); });
    var hash = new URLSearchParams((url.hash || "").replace(/^#/, ""));
    var had = false;
    keys.forEach(function (k) {
      if (hash.has(k)) { hash.delete(k); had = true; }
    });
    if (had) {
      var rest = hash.toString();
      url.hash = rest ? "#" + rest : "";
    }
    return url.pathname + url.search + url.hash;
  }
  function shouldRetryOtp(err) {
    var msg = (err && err.message) || "";
    if (!msg) return false;
    if (/rate limit|network|fetch/i.test(msg)) return false;
    return /token|otp|expired|invalid|not found/i.test(msg);
  }
  function authFailureMessage(err) {
    var msg = (err && err.message) || String(err || "");
    if (/rate limit/i.test(msg)) return "寄信太頻繁，請稍後再試";
    if (/invalid login credentials/i.test(msg)) return "電子郵件或密碼不正確。若還沒設定密碼，請先打開信裡的連結登入，再按「設定密碼」。";
    if (/email not confirmed/i.test(msg)) return "請先打開信裡的連結完成登入，再設定密碼。";
    var least = msg.match(/at least (\d+) character/i);
    if (least) return "密碼至少要 " + least[1] + " 個字";
    if (/password should be at least/i.test(msg)) return "密碼太短";
    if (/same password|should be different from the old/i.test(msg)) return "新密碼不能和目前的一樣";
    if (/weak password|pwned|leaked|easy to guess/i.test(msg)) return "這組密碼太容易猜，請換一組";
    if (/auth session missing|session missing/i.test(msg)) return "請重新登入後再設定密碼";
    if (/verifier|code challenge|both auth code|not a valid implicit|not a valid pkce/i.test(msg)) {
      return "這個連結無法在這台裝置完成登入。請再寄一次登入信；若已設定密碼，請改用密碼登入。";
    }
    if (/token|otp|expired|invalid|not found/i.test(msg)) {
      return "登入連結已經用過或失效。請再寄一次登入信。若已設定密碼，請改用密碼登入。";
    }
    if (/invalid email|validate email|unable to validate/i.test(msg)) return "電子郵件格式不正確";
    return msg ? ("登入失敗：" + msg) : "登入失敗。請再寄一次登入信，或改用密碼登入。";
  }
  function planSync(localUser, remoteRows, nowIso) {
    var remoteUser = userFromRows(remoteRows);
    var merged = mergeProgress(localUser, remoteUser, nowIso);
    var remoteById = {};
    (remoteRows || []).forEach(function (row) { if (row && row.job_id) remoteById[String(row.job_id)] = row; });
    var upserts = [];
    var keep = {};
    rowsFromUser(merged).forEach(function (row) {
      keep[row.job_id] = 1;
      if (!sameRow(row, remoteById[row.job_id])) upserts.push(row);
    });
    var deletes = Object.keys(remoteById).filter(function (id) { return !keep[id]; });
    return { merged: merged, upserts: upserts, deletes: deletes };
  }
  function authRedirectUrl(href) {
    var origin = "";
    try { origin = new URL(String(href || "")).origin; }
    catch (e) { return ""; }
    if (/^https:\/\//i.test(origin)) return origin;
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
    return "";
  }
  var api = {
    filterJobs: filterJobs, sortJobs: sortJobs, payNumber: payNumber, mergeUser: mergeUser, hasDays: hasDays,
    emptyUser: emptyUser, isSupabaseConfigured: isSupabaseConfigured, supabaseConfigError: supabaseConfigError,
    looksLikeServiceRole: looksLikeServiceRole, mergeProgress: mergeProgress, planSync: planSync,
    rowsFromUser: rowsFromUser, userFromRows: userFromRows, normalizeSupabaseUrl: normalizeSupabaseUrl,
    applyImport: applyImport, otpTypesToTry: otpTypesToTry, parseAuthCallback: parseAuthCallback,
    stripAuthParams: stripAuthParams, shouldRetryOtp: shouldRetryOtp, authFailureMessage: authFailureMessage,
    authRedirectUrl: authRedirectUrl
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (typeof document === "undefined") return;

  // ---------- 瀏覽器端 ----------
  var $ = function (id) { return document.getElementById(id); };
  var state = { jobs: [], orgs: [], meta: null, shown: PAGE, user: loadUser() };
  var TODAY = Date.now();
  var sb = null;
  var session = null;
  var syncing = false;
  var syncAgain = false;
  var cloudTimer = null;
  var lastPull = 0;
  var authPending = false;
  var loginErrorShown = false;
  var SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js";

  function loadUser() {
    try { return mergeUser(JSON.parse(localStorage.getItem(STORE_KEY) || "{}"), null); }
    catch (e) { return mergeUser(null, null); }
  }
  function saveLocal() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.user)); }
    catch (e) { toast("無法儲存（瀏覽器可能關閉了本機儲存）"); }
    var favCount = $("favCount");
    if (favCount) favCount.textContent = Object.keys(state.user.fav).length;
  }
  function saveUser() {
    saveLocal();
    scheduleCloudSync();
  }
  function cloudOn() {
    return isSupabaseConfigured(window.JOB_TRACKER_SUPABASE);
  }
  function notePlaceholder() {
    if (!cloudOn()) return "我的備註（只存在這台裝置）";
    if (session) return "我的備註（會同步到已登入的帳號）";
    return "我的備註（登入後可跨裝置同步）";
  }
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : "#"; }
  function fetchJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " HTTP " + r.status);
      return r.json();
    });
  }

  function card(j) {
    var u = state.user, url = j.url, st = u.status[url] || "", fav = !!u.fav[url];
    var isNew = (TODAY - Date.parse(j.firstSeen || "")) / 86400000 <= 7 && !j.seed;
    var badges = ['<span class="b cat">' + esc(j.category) + "</span>"];
    if (isNew) badges.push('<span class="b new">NEW</span>');
    if (j.remote) badges.push('<span class="b remote">遠端</span>');
    if (j.intern) badges.push('<span class="b intern">實習</span>');
    if (j.informal) badges.push('<span class="b inf">非正式・未查證</span>');
    if (j.aiFit) badges.push('<span class="b fit-' + esc(j.aiFit) + '">AI：' + esc(j.aiFit) + "</span>");
    badges.push('<span class="b">' + esc(j.source) + "</span>");
    if (j.gone) badges.push('<span class="b">已不在最新清單</span>');
    var dateTxt = j.date ? j.date : (j.dateText || "未提供");
    var opts = '<option value="">狀態…</option>' + STATUSES.map(function (s) {
      return '<option' + (s === st ? " selected" : "") + ">" + s + "</option>";
    }).join("");
    return '<article class="card' + (st === "不考慮" ? " no" : "") + '" data-url="' + esc(url) + '">' +
      '<div class="head"><h3><a href="' + esc(safeUrl(url)) + '" target="_blank" rel="noopener">' + esc(j.title) + "</a></h3>" +
      '<button class="star' + (fav ? " on" : "") + '" data-act="fav" title="收藏" aria-label="收藏">' + (fav ? "★" : "☆") + "</button></div>" +
      '<div class="co">' + esc(j.company) + "</div>" +
      '<div class="badges">' + badges.join("") + "</div>" +
      '<dl class="f">' +
      "<dt>地點</dt><dd>" + esc(j.location) + "</dd>" +
      "<dt>類型</dt><dd>" + esc(j.type) + (j.experience && j.experience !== "未提供" ? "・經歷 " + esc(j.experience) : "") + "</dd>" +
      "<dt>薪資</dt><dd>" + esc(j.salary) + "</dd>" +
      "<dt>工作天數</dt><dd>" + esc(j.workDays || "未提供") + "</dd>" +
      "<dt>實體／遠端</dt><dd>" + esc(j.onsiteDays || "未提供") + "</dd>" +
      "<dt>日期</dt><dd>" + esc(dateTxt) + '<span class="hint">（首次出現 ' + esc(j.firstSeen || "—") + "）</span></dd>" +
      "</dl>" +
      (j.fitNote ? '<div class="fit">' + esc(j.fitNote) + "</div>" : "") +
      '<div class="mine"><select data-act="status" aria-label="狀態">' + opts + "</select>" +
      '<textarea data-act="note" placeholder="' + esc(notePlaceholder()) + '" aria-label="我的備註">' + esc(u.note[url] || "") + "</textarea></div>" +
      "</article>";
  }

  function currentFilters() {
    return {
      q: $("q").value, cat: $("fCat").value, src: $("fSrc").value, status: $("fStatus").value, fit: $("fFit").value,
      sal: $("fSal").value.trim(), remote: $("fRemote").checked, intern: $("fIntern").checked, days: $("fDays").checked,
      isNew: $("fNew").checked, hideNo: $("fHideNo").checked
    };
  }
  function activeFilterCount() {
    var n = 0;
    if ($("fCat").value) n++;
    if ($("fSrc").value) n++;
    if ($("fStatus").value) n++;
    if ($("fFit") && !$("fFit").hidden && $("fFit").value) n++;
    if ($("fSal").value.trim()) n++;
    if ($("sort").value && $("sort").value !== "date") n++;
    if ($("fRemote").checked) n++;
    if ($("fIntern").checked) n++;
    if ($("fDays").checked) n++;
    if ($("fNew").checked) n++;
    if ($("fHideNo").checked) n++;
    return n;
  }
  function updateFilterToggle() {
    var btn = $("filterToggle");
    var box = $("jobFilters");
    if (!btn || !box) return;
    var open = box.classList.contains("is-open");
    var n = activeFilterCount();
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.textContent = open ? "收合篩選" : (n ? "篩選（" + n + "）" : "篩選");
  }
  function renderJobs() {
    var list = sortJobs(filterJobs(state.jobs, currentFilters(), state.user, TODAY), $("sort").value);
    $("count").textContent = "符合 " + list.length + " 筆（共 " + state.jobs.length + " 筆）";
    $("list").innerHTML = list.length ? list.slice(0, state.shown).map(card).join("") : '<p class="empty">沒有符合條件的職缺，試著放寬篩選。</p>';
    $("more").hidden = list.length <= state.shown;
    updateFilterToggle();
  }
  function renderFavs() {
    var u = state.user, byUrl = {};
    state.jobs.forEach(function (j) { byUrl[j.url] = j; });
    var list = Object.keys(u.fav).map(function (url) {
      return byUrl[url] || Object.assign({ gone: true }, u.favJobs[url] || { url: url, title: url, company: "", category: "" });
    });
    list = sortJobs(list, "date");
    $("favList").innerHTML = list.length ? list.map(card).join("") : '<p class="empty">還沒有收藏。在職缺卡片右上角按 ☆ 就能收藏。</p>';
  }
  function renderOrgs() {
    var q = norm($("oq").value).trim(), ty = $("oType").value;
    var list = state.orgs.filter(function (o) {
      if (ty && o.type !== ty) return false;
      return !q || norm([o.name, o.description, o.location, o.type].join(" ")).indexOf(q) >= 0;
    });
    $("ocount").textContent = "共 " + list.length + " 個組織";
    $("orgList").innerHTML = list.map(function (o) {
      var jobs = (o.jobs || []).map(function (u, i) { return '<a href="' + esc(safeUrl(u)) + '" target="_blank" rel="noopener">相關職缺 ' + (i + 1) + "</a>"; }).join("");
      return '<article class="card org"><h3><a href="' + esc(safeUrl(o.url)) + '" target="_blank" rel="noopener">' + esc(o.name) + "</a></h3>" +
        '<div class="badges"><span class="b cat">' + esc(o.type) + "</span></div>" +
        "<div>" + esc(o.description) + '</div><div class="co">📍 ' + esc(o.location || "未提供") + "</div>" +
        (jobs ? '<div class="jobs">' + jobs + "</div>" : "") + "</article>";
    }).join("") || '<p class="empty">沒有符合的組織。</p>';
  }
  function renderAbout() {
    var m = state.meta, h = "<h2>資料來源與最近一次更新</h2>";
    if (!m) { h += "<p>尚未有自動更新紀錄（目前顯示的是初始資料）。</p>"; }
    else {
      h += "<p>最近一次執行：" + esc(m.lastRun) + "（台北時間）；共 " + m.total + " 筆，本次新增 " + m.newThisRun + " 筆，移除超過 " + m.keepDays + " 天的 " + m.removedOld + " 筆。</p>";
      h += "<table><tr><th>來源</th><th>狀態</th><th>抓到</th><th>符合條件</th><th>新增</th><th>錯誤</th></tr>";
      Object.keys(m.sources || {}).forEach(function (k) {
        var s = m.sources[k], cls = s.status === "成功" ? "ok" : s.status === "失敗" ? "bad" : "part";
        var err = esc((s.errors || []).slice(0, 2).join("；")) || "—";
        h += "<tr><td data-label=\"來源\">" + esc(k) + '</td><td data-label="狀態" class="' + cls + '">' + esc(s.status) +
          "</td><td data-label=\"抓到\">" + (s.fetched == null ? "—" : s.fetched) +
          "</td><td data-label=\"符合條件\">" + (s.kept == null ? "—" : s.kept) +
          "</td><td data-label=\"新增\">" + (s.new == null ? "—" : s.new) +
          "</td><td data-label=\"錯誤\">" + err + "</td></tr>";
      });
      h += "</table>";
      if (m.ai) h += "<p>AI 篩選：模型 " + esc(m.ai.model) + "，處理 " + m.ai.processed + " 筆（輸入 " + m.ai.prompt_tokens + "、輸出 " + m.ai.completion_tokens + " tokens）。</p>";
    }
    h += "<h3>說明</h3><ul><li>「非正式・未查證」代表來自 PTT 或家教網的個人貼文，請自行確認對方身分，不要先付費或提供證件。</li>" +
      "<li>104 的日期是職缺「更新日」，不一定是首次刊登日；Yourator 只提供「一週內更新」這類相對時間。</li>" +
      "<li>" + (cloudOn()
        ? "登入後，收藏、狀態與備註會在你的裝置之間同步，這台裝置也會留一份離線備份。仍可到「我的收藏」匯出 JSON。"
        : "收藏、狀態與備註只存在這個瀏覽器；請到「我的收藏」匯出備份。") + "</li></ul>";
    $("about").innerHTML = h;
  }
  function fillSelect(sel, values) {
    values.forEach(function (v) { var o = document.createElement("option"); o.value = o.textContent = v; sel.appendChild(o); });
  }

  function onCardEvent(e) {
    var el = e.target, art = el.closest && el.closest(".card[data-url]");
    if (!art) return;
    var url = art.getAttribute("data-url"), act = el.getAttribute("data-act"), u = state.user;
    if (act === "fav" && e.type === "click") {
      var cur = state.user;
      if (cur.fav[url]) { delete cur.fav[url]; delete cur.favJobs[url]; toast("已取消收藏"); }
      else {
        cur.fav[url] = true;
        var j = state.jobs.filter(function (x) { return x.url === url; })[0];
        if (j) cur.favJobs[url] = j; // 存一份快照，職缺過期後仍看得到
        toast("已加入收藏 ★");
      }
      cur.updated[url] = new Date().toISOString();
      saveUser(); el.classList.toggle("on", !!cur.fav[url]); el.textContent = cur.fav[url] ? "★" : "☆";
      if (!$("tab-favs").hidden) renderFavs();
    } else if (act === "status" && e.type === "change") {
      if (el.value) state.user.status[url] = el.value; else delete state.user.status[url];
      state.user.updated[url] = new Date().toISOString();
      art.classList.toggle("no", el.value === "不考慮"); saveUser();
    } else if (act === "note" && e.type === "input") {
      clearTimeout(onCardEvent._t);
      onCardEvent._t = setTimeout(function () {
        var note = el.value;
        if (note.trim()) state.user.note[url] = note.slice(0, 20000); else delete state.user.note[url];
        state.user.updated[url] = new Date().toISOString();
        saveUser();
      }, 400);
    }
  }

  function exportUser() {
    var data = Object.assign({ app: "jerry-job-tracker", version: 1, exportedAt: new Date().toISOString() }, state.user);
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "職缺收藏備份-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("已匯出");
  }
  function importUser(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var inc = JSON.parse(r.result);
        if (!inc || typeof inc !== "object" || !inc.fav) throw new Error("格式不符");
        state.user = applyImport(state.user, inc, new Date().toISOString());
        saveUser(); renderFavs(); renderJobs();
        toast("匯入完成：收藏 " + Object.keys(state.user.fav).length + " 筆");
      } catch (e) { toast("匯入失敗：" + e.message); }
    };
    r.readAsText(file);
  }

  function switchTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === name); });
    ["jobs", "favs", "orgs", "about"].forEach(function (t) { $("tab-" + t).hidden = t !== name; });
    if (name === "favs") renderFavs();
    if (name === "orgs") renderOrgs();
    if (name === "about") renderAbout();
    try { history.replaceState(null, "", "#" + name); } catch (e) {}
  }

  function setSyncStatus(text, kind) {
    ["syncStatus", "syncSheetStatus"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.textContent = text;
      el.className = "sync-status" + (kind ? " " + kind : "");
    });
  }
  function syncSheetOpen() {
    var panel = $("syncPanel");
    var pw = $("syncSetPassword");
    return !!((panel && !panel.hidden) || (pw && !pw.hidden));
  }
  function refreshSyncSheet() {
    var open = syncSheetOpen();
    var narrow = window.matchMedia("(max-width: 640px)").matches;
    var bd = $("syncBackdrop");
    if (bd) bd.hidden = !open || !narrow;
    document.body.classList.toggle("sync-open", !!(open && narrow));
    var panel = $("syncPanel");
    if (panel) {
      if (open && narrow && !panel.hidden) {
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-labelledby", "syncSheetTitle");
      } else {
        panel.removeAttribute("role");
        panel.removeAttribute("aria-modal");
        panel.removeAttribute("aria-labelledby");
      }
    }
    var pw = $("syncSetPassword");
    if (pw) {
      if (open && narrow && !pw.hidden) {
        pw.setAttribute("role", "dialog");
        pw.setAttribute("aria-modal", "true");
        pw.setAttribute("aria-labelledby", "syncPasswordTitle");
      } else {
        pw.removeAttribute("role");
        pw.removeAttribute("aria-modal");
        pw.removeAttribute("aria-labelledby");
      }
    }
  }
  function closeSyncSheets() {
    if ($("syncPanel")) $("syncPanel").hidden = true;
    if ($("syncSetPassword")) $("syncSetPassword").hidden = true;
    refreshSyncSheet();
  }
  function showSyncLoggedOut() {
    session = null;
    var panel = $("syncPanel");
    if (panel) panel.hidden = true;
    var who = $("syncWho");
    if (who) { who.hidden = true; who.textContent = ""; }
    if ($("syncLogout")) $("syncLogout").hidden = true;
    if ($("syncToggle")) $("syncToggle").hidden = false;
    if ($("syncPasswordOpen")) $("syncPasswordOpen").hidden = true;
    if ($("syncSetPassword")) $("syncSetPassword").hidden = true;
    setSyncStatus("尚未登入・只存在這台裝置", "");
    refreshSyncSheet();
  }
  function showSyncLoggedIn(email) {
    var panel = $("syncPanel");
    if (panel) panel.hidden = true;
    if ($("syncToggle")) $("syncToggle").hidden = true;
    var who = $("syncWho");
    if (who) { who.hidden = false; who.textContent = email || "已登入"; }
    if ($("syncLogout")) $("syncLogout").hidden = false;
    if ($("syncPasswordOpen")) $("syncPasswordOpen").hidden = false;
    refreshSyncSheet();
  }
  function zhAuthError(e) { return authFailureMessage(e); }
  function openLoginPanel() {
    var panel = $("syncPanel");
    if (panel) panel.hidden = false;
    if ($("syncSetPassword")) $("syncSetPassword").hidden = true;
    if ($("syncToggle")) $("syncToggle").hidden = false;
    refreshSyncSheet();
  }
  function showLoginError(message) {
    loginErrorShown = true;
    authPending = false;
    openLoginPanel();
    setSyncStatus(message, "bad");
    toast(message);
  }
  function clearAuthCallback() {
    try { history.replaceState(null, "", stripAuthParams(location.href)); } catch (e) {}
  }
  function verifyWithTypes(makeParams, types) {
    var i = 0;
    function next() {
      if (i >= types.length) return Promise.reject(new Error("登入連結已經用過或失效"));
      var type = types[i];
      i += 1;
      return sb.auth.verifyOtp(makeParams(type)).then(function (res) {
        if (res && !res.error) return res;
        var err = (res && res.error) || new Error("登入失敗");
        if (shouldRetryOtp(err) && i < types.length) return next();
        throw err;
      });
    }
    return next();
  }
  function settleAuthCallback(callback) {
    callback = callback || {};
    if (callback.tokenHash) {
      authPending = true;
      loginErrorShown = false;
      setSyncStatus("正在用登入連結登入…", "");
      clearAuthCallback();
      return verifyWithTypes(function (type) {
        return { token_hash: callback.tokenHash, type: type };
      }, otpTypesToTry(callback.type)).then(function () {
        authPending = false;
        toast("已登入");
      }).catch(function (e) {
        showLoginError(authFailureMessage(e));
      });
    }
    if (callback.accessToken) {
      authPending = true;
      loginErrorShown = false;
      setSyncStatus("正在登入…", "");
      return sb.auth.getSession().then(function (res) {
        var sess = res && res.data && res.data.session;
        if (sess && sess.user) {
          clearAuthCallback();
          authPending = false;
          toast("已登入");
          return;
        }
        if (!callback.refreshToken || !sb.auth.setSession) {
          clearAuthCallback();
          showLoginError("登入連結沒有完成。請再寄一次登入信。若已設定密碼，請改用密碼登入。");
          return;
        }
        return sb.auth.setSession({ access_token: callback.accessToken, refresh_token: callback.refreshToken }).then(function (setRes) {
          clearAuthCallback();
          if (setRes && setRes.data && setRes.data.session) {
            authPending = false;
            toast("已登入");
            return;
          }
          showLoginError(authFailureMessage((setRes && setRes.error) || { message: "登入連結沒有完成" }));
        });
      }).catch(function (e) {
        clearAuthCallback();
        showLoginError(authFailureMessage(e));
      });
    }
    if (callback.code) {
      clearAuthCallback();
      showLoginError("這個連結無法在這台裝置完成登入。請再寄一次登入信；若已設定密碼，請改用密碼登入。");
      return Promise.resolve();
    }
    if (callback.error) {
      clearAuthCallback();
      showLoginError(authFailureMessage({ message: callback.error }));
      return Promise.resolve();
    }
    return Promise.resolve();
  }
  function loadSupabaseJs() {
    return new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve();
      var s = document.createElement("script");
      s.src = SUPABASE_JS;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("無法載入同步元件")); };
      document.head.appendChild(s);
    });
  }
  function cloudReady() { return !!(sb && session && session.user); }
  function scheduleCloudSync() {
    if (!cloudReady()) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(function () { syncNow(); }, 1000);
  }
  function noteIsFocused() {
    var el = document.activeElement;
    return !!(el && el.getAttribute && el.getAttribute("data-act") === "note");
  }
  function renderAfterSync() {
    saveLocal();
    if (noteIsFocused()) return;
    renderJobs();
    if ($("tab-favs") && !$("tab-favs").hidden) renderFavs();
  }
  function fetchAllRows() {
    var page = 1000, from = 0, all = [];
    function next() {
      return sb.from("job_progress")
        .select("job_id,favorite,status,note,fav_snapshot,updated_at")
        .order("job_id", { ascending: true })
        .range(from, from + page - 1)
        .then(function (res) {
          if (res.error) throw res.error;
          var rows = res.data || [];
          all = all.concat(rows);
          if (rows.length < page) return all;
          from += page;
          return next();
        });
    }
    return next();
  }
  function withUserId(rows) {
    var uid = session.user.id;
    return rows.map(function (row) {
      return {
        user_id: uid,
        job_id: row.job_id,
        favorite: row.favorite,
        status: row.status,
        note: row.note,
        fav_snapshot: row.fav_snapshot,
        updated_at: row.updated_at
      };
    });
  }
  function upsertChunks(rows) {
    var size = 100, i = 0;
    function next() {
      if (i >= rows.length) return Promise.resolve();
      var chunk = withUserId(rows.slice(i, i + size));
      i += size;
      return sb.from("job_progress").upsert(chunk, { onConflict: "user_id,job_id" }).then(function (res) {
        if (res.error) throw res.error;
        return next();
      });
    }
    return next();
  }
  function deleteChunks(ids) {
    var size = 100, i = 0;
    function next() {
      if (i >= ids.length) return Promise.resolve();
      var chunk = ids.slice(i, i + size);
      i += size;
      return sb.from("job_progress").delete().in("job_id", chunk).then(function (res) {
        if (res.error) throw res.error;
        return next();
      });
    }
    return next();
  }
  function pullMergePush() {
    return fetchAllRows().then(function (rows) {
      var plan = planSync(state.user, rows, new Date().toISOString());
      state.user = plan.merged;
      renderAfterSync();
      return Promise.all([upsertChunks(plan.upserts), deleteChunks(plan.deletes)]);
    });
  }
  function syncNow() {
    if (!cloudReady()) return Promise.resolve();
    if (syncing) { syncAgain = true; return Promise.resolve(); }
    syncing = true;
    lastPull = Date.now();
    setSyncStatus("已登入・同步中…", "");
    return pullMergePush().then(function () {
      setSyncStatus("已登入・已同步", "ok");
    }).catch(function () {
      var offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setSyncStatus(offline ? "已登入・離線，變更已存在這台裝置" : "已登入・同步失敗，變更已存在這台裝置", "warn");
    }).then(function () {
      syncing = false;
      if (syncAgain) { syncAgain = false; return syncNow(); }
    });
  }
  function handleAuth(event, sess) {
    if (!sess) {
      if (authPending || loginErrorShown) return;
      showSyncLoggedOut();
      return;
    }
    loginErrorShown = false;
    session = sess;
    showSyncLoggedIn(sess.user && sess.user.email);
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "USER_UPDATED") syncNow();
  }
  function emailValue() {
    return ($("syncEmail") && $("syncEmail").value || "").trim();
  }
  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  function sendMagicLink(ev) {
    if (ev) ev.preventDefault();
    if (!sb) { toast("同步還沒準備好，請稍後再試"); return; }
    var email = emailValue();
    if (!validEmail(email)) { toast("請輸入有效的電子郵件"); return; }
    $("syncSend").disabled = true;
    setSyncStatus("正在寄送登入信…", "");
    sb.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: authRedirectUrl(location.href) || undefined, shouldCreateUser: true }
    }).then(function (res) {
      if (res.error) throw res.error;
      loginErrorShown = false;
      setSyncStatus("登入信已寄出。請在要登入的那台手機或電腦打開連結。登入後按「設定密碼」，其他裝置就能用密碼登入。", "ok");
    }).catch(function (e) {
      setSyncStatus("寄送失敗", "bad");
      toast("寄送失敗：" + zhAuthError(e));
    }).then(function () { $("syncSend").disabled = false; });
  }
  function verifyCode(ev) {
    if (ev) ev.preventDefault();
    if (!sb) { toast("同步還沒準備好，請稍後再試"); return; }
    var email = emailValue();
    var code = ($("syncCode").value || "").trim();
    if (!validEmail(email)) { toast("請輸入有效的電子郵件"); return; }
    if (!/^[0-9]{6,10}$/.test(code)) { toast("請輸入信裡的驗證碼"); return; }
    $("syncVerify").disabled = true;
    loginErrorShown = false;
    authPending = true;
    setSyncStatus("正在登入…", "");
    verifyWithTypes(function (type) {
      return { email: email, token: code, type: type };
    }, otpTypesToTry("email")).then(function () {
      authPending = false;
      toast("已登入");
    }).catch(function (e) {
      showLoginError(authFailureMessage(e));
    }).then(function () { $("syncVerify").disabled = false; });
  }
  function signInWithPassword() {
    if (!sb) { toast("同步還沒準備好，請稍後再試"); return; }
    var email = emailValue();
    var password = ($("syncPassword") && $("syncPassword").value) || "";
    if (!validEmail(email)) { toast("請輸入有效的電子郵件"); return; }
    if (!password) { toast("請輸入密碼"); return; }
    $("syncPasswordBtn").disabled = true;
    loginErrorShown = false;
    authPending = true;
    setSyncStatus("正在登入…", "");
    sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      if (res.error) throw res.error;
      if ($("syncPassword")) $("syncPassword").value = "";
      authPending = false;
      toast("已登入");
    }).catch(function (e) {
      showLoginError(authFailureMessage(e));
    }).then(function () { $("syncPasswordBtn").disabled = false; });
  }
  function setPassword(ev) {
    if (ev) ev.preventDefault();
    if (!sb || !session) { toast("請先登入"); return; }
    var first = ($("syncNewPassword") && $("syncNewPassword").value) || "";
    var second = ($("syncNewPassword2") && $("syncNewPassword2").value) || "";
    if (first.length < 6) { toast("密碼至少要 6 個字"); return; }
    if (first !== second) { toast("兩次密碼不一致"); return; }
    $("syncSavePassword").disabled = true;
    sb.auth.updateUser({ password: first }).then(function (res) {
      if (res.error) throw res.error;
      if ($("syncNewPassword")) $("syncNewPassword").value = "";
      if ($("syncNewPassword2")) $("syncNewPassword2").value = "";
      if ($("syncSetPassword")) $("syncSetPassword").hidden = true;
      refreshSyncSheet();
      toast("密碼已設定。其他裝置可以用這個電子郵件和密碼登入。");
    }).catch(function (e) {
      toast(authFailureMessage(e));
    }).then(function () { $("syncSavePassword").disabled = false; });
  }
  function logout() {
    if (!sb) { showSyncLoggedOut(); return; }
    $("syncLogout").disabled = true;
    sb.auth.signOut({ scope: "local" }).catch(function () {}).then(function () {
      $("syncLogout").disabled = false;
      showSyncLoggedOut();
      toast("已登出，這台裝置仍留著一份資料");
    });
  }
  function initCloud() {
    var cfg = window.JOB_TRACKER_SUPABASE || null;
    var problem = supabaseConfigError(cfg);
    if (!problem && !isSupabaseConfigured(cfg)) return;
    var bar = $("syncbar");
    if (bar) bar.hidden = false;
    var hint = $("storageHint");
    if (hint && isSupabaseConfigured(cfg)) {
      hint.textContent = "登入後會在手機與電腦之間同步。可以設定密碼，其他裝置就不用再收信。這台裝置也留一份離線備份。仍可匯出 JSON。";
    }
    if (problem) {
      setSyncStatus(problem, "bad");
      if ($("syncToggle")) $("syncToggle").hidden = true;
      return;
    }
    setSyncStatus("正在準備同步…", "");
    var callback = parseAuthCallback(location.href);
    loadSupabaseJs().then(function () {
      if (!window.supabase || !window.supabase.createClient) throw new Error("同步元件未就緒");
      // implicit：登入連結把工作階段放在網址裡，任何裝置都能登入，不靠原本那台瀏覽器的 PKCE verifier。
      sb = window.supabase.createClient(normalizeSupabaseUrl(cfg.url), String(cfg.anonKey).trim(), {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
      });
      sb.auth.onAuthStateChange(function (event, sess) {
        setTimeout(function () { handleAuth(event, sess); }, 0);
      });
      return settleAuthCallback(callback);
    }).catch(function () {
      showSyncLoggedOut();
      setSyncStatus("無法載入同步元件・只存在這台裝置", "warn");
      if ($("syncToggle")) $("syncToggle").hidden = true;
    });
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.addEventListener("click", function () { switchTab(b.getAttribute("data-tab")); });
    });
    ["q", "fSal"].forEach(function (id) { $(id).addEventListener("input", function () { state.shown = PAGE; renderJobs(); }); });
    ["fCat", "fSrc", "fStatus", "fFit", "sort", "fRemote", "fIntern", "fDays", "fNew", "fHideNo"].forEach(function (id) {
      $(id).addEventListener("change", function () { state.shown = PAGE; renderJobs(); });
    });
    $("reset").addEventListener("click", function () {
      ["q", "fSal"].forEach(function (id) { $(id).value = ""; });
      ["fCat", "fSrc", "fStatus", "fFit"].forEach(function (id) { $(id).value = ""; });
      ["fRemote", "fIntern", "fDays", "fNew", "fHideNo"].forEach(function (id) { $(id).checked = false; });
      $("sort").value = "date"; renderJobs();
    });
    $("more").addEventListener("click", function () { state.shown += PAGE; renderJobs(); });
    ["list", "favList"].forEach(function (id) {
      ["click", "change", "input"].forEach(function (ev) { $(id).addEventListener(ev, onCardEvent); });
    });
    $("export").addEventListener("click", exportUser);
    $("import").addEventListener("change", function (e) { if (e.target.files[0]) importUser(e.target.files[0]); e.target.value = ""; });
    $("oq").addEventListener("input", renderOrgs);
    $("oType").addEventListener("change", renderOrgs);
    $("favCount").textContent = Object.keys(state.user.fav).length;
    if ($("filterToggle")) $("filterToggle").addEventListener("click", function () {
      var box = $("jobFilters");
      if (!box) return;
      box.classList.toggle("is-open");
      updateFilterToggle();
    });
    if ($("syncToggle")) $("syncToggle").addEventListener("click", function () {
      var panel = $("syncPanel");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if ($("syncSetPassword")) $("syncSetPassword").hidden = true;
      refreshSyncSheet();
      if (!panel.hidden && $("syncEmail")) $("syncEmail").focus();
    });
    if ($("syncClose")) $("syncClose").addEventListener("click", closeSyncSheets);
    if ($("syncPasswordClose")) $("syncPasswordClose").addEventListener("click", closeSyncSheets);
    if ($("syncBackdrop")) $("syncBackdrop").addEventListener("click", closeSyncSheets);
    window.addEventListener("resize", refreshSyncSheet);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && syncSheetOpen()) closeSyncSheets();
    });
    if ($("syncPasswordBtn")) $("syncPasswordBtn").addEventListener("click", function (ev) {
      if (ev) ev.preventDefault();
      signInWithPassword();
    });
    if ($("syncLogin")) $("syncLogin").addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (document.activeElement && document.activeElement.id === "syncPassword") signInWithPassword();
      else sendMagicLink();
    });
    if ($("syncCodeForm")) $("syncCodeForm").addEventListener("submit", verifyCode);
    if ($("syncPasswordOpen")) $("syncPasswordOpen").addEventListener("click", function () {
      var form = $("syncSetPassword");
      if (!form) return;
      form.hidden = !form.hidden;
      if ($("syncPanel")) $("syncPanel").hidden = true;
      refreshSyncSheet();
      if (!form.hidden && $("syncNewPassword")) $("syncNewPassword").focus();
    });
    if ($("syncSetPassword")) $("syncSetPassword").addEventListener("submit", setPassword);
    if ($("syncLogout")) $("syncLogout").addEventListener("click", logout);
    window.addEventListener("online", function () { if (cloudReady()) syncNow(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || !cloudReady()) return;
      if (Date.now() - lastPull < 15000) return;
      syncNow();
    });
    initCloud();

    Promise.all([
      fetchJSON("data/jobs.json"),
      fetchJSON("data/companies.json").catch(function () { return { companies: [] }; }),
      fetchJSON("data/meta.json").catch(function () { return null; })
    ]).then(function (r) {
      state.jobs = (r[0].jobs || []).filter(function (j) { return j && j.url && j.title; });
      state.orgs = r[1].companies || [];
      state.meta = r[2];
      $("updated").textContent = "資料更新：" + String(r[0].updated || "未知").replace("T", " ").slice(0, 16) + "（台北時間）・共 " + state.jobs.length + " 筆";
      var cats = {}, srcs = {}, types = {}, fit = false;
      state.jobs.forEach(function (j) { cats[j.category] = 1; srcs[j.source] = 1; if (j.aiFit) fit = true; });
      state.orgs.forEach(function (o) { types[o.type] = 1; });
      fillSelect($("fCat"), CAT_ORDER.filter(function (c) { return cats[c]; }).concat(Object.keys(cats).filter(function (c) { return CAT_ORDER.indexOf(c) < 0; })));
      fillSelect($("fSrc"), Object.keys(srcs).sort());
      fillSelect($("oType"), Object.keys(types));
      $("fFit").hidden = !fit;
      renderJobs();
      var h = (location.hash || "").slice(1);
      if (["favs", "orgs", "about"].indexOf(h) >= 0) switchTab(h);
      document.body.setAttribute("data-loaded", String(state.jobs.length));
    }).catch(function (e) {
      $("updated").textContent = "資料載入失敗：" + e.message + "（若是直接開啟檔案，請改用網址或本機伺服器）";
      document.body.setAttribute("data-error", e.message);
    });
  }
  init();
})();
