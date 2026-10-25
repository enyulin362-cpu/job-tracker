/* Anya 的職缺追蹤 — 純前端，無需建置。收藏／狀態／備註存在 localStorage。 */
(function () {
  "use strict";
  var STORE_KEY = "jerry-job-tracker-v1";
  var PAGE = 60;
  var STATUSES = ["想投", "已投", "面試", "不考慮"];
  var CAT_ORDER = ["設計與生涯", "藝術與諮詢", "一般工讀", "家教伴讀"];

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
  function mergeUser(base, inc) {
    var out = { fav: {}, status: {}, note: {}, favJobs: {} };
    ["fav", "status", "note", "favJobs"].forEach(function (k) {
      Object.assign(out[k], (base && base[k]) || {}, (inc && inc[k]) || {});
    });
    return out;
  }
  var api = { filterJobs: filterJobs, sortJobs: sortJobs, payNumber: payNumber, mergeUser: mergeUser, hasDays: hasDays };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (typeof document === "undefined") return;

  // ---------- 瀏覽器端 ----------
  var $ = function (id) { return document.getElementById(id); };
  var state = { jobs: [], orgs: [], meta: null, shown: PAGE, user: loadUser() };
  var TODAY = Date.now();

  function loadUser() {
    try { return mergeUser(JSON.parse(localStorage.getItem(STORE_KEY) || "{}"), null); }
    catch (e) { return mergeUser(null, null); }
  }
  function saveUser() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.user)); } catch (e) { toast("無法儲存（瀏覽器可能關閉了本機儲存）"); }
    $("favCount").textContent = Object.keys(state.user.fav).length;
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
      '<textarea data-act="note" placeholder="我的備註（只存在這台裝置）" aria-label="我的備註">' + esc(u.note[url] || "") + "</textarea></div>" +
      "</article>";
  }

  function currentFilters() {
    return {
      q: $("q").value, cat: $("fCat").value, src: $("fSrc").value, status: $("fStatus").value, fit: $("fFit").value,
      sal: $("fSal").value.trim(), remote: $("fRemote").checked, intern: $("fIntern").checked, days: $("fDays").checked,
      isNew: $("fNew").checked, hideNo: $("fHideNo").checked
    };
  }
  function renderJobs() {
    var list = sortJobs(filterJobs(state.jobs, currentFilters(), state.user, TODAY), $("sort").value);
    $("count").textContent = "符合 " + list.length + " 筆（共 " + state.jobs.length + " 筆）";
    $("list").innerHTML = list.length ? list.slice(0, state.shown).map(card).join("") : '<p class="empty">沒有符合條件的職缺，試著放寬篩選。</p>';
    $("more").hidden = list.length <= state.shown;
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
        h += "<tr><td>" + esc(k) + '</td><td class="' + cls + '">' + esc(s.status) + "</td><td>" + (s.fetched == null ? "—" : s.fetched) +
          "</td><td>" + (s.kept == null ? "—" : s.kept) + "</td><td>" + (s.new == null ? "—" : s.new) + "</td><td>" + esc((s.errors || []).slice(0, 2).join("；")) + "</td></tr>";
      });
      h += "</table>";
      if (m.ai) h += "<p>AI 篩選：模型 " + esc(m.ai.model) + "，處理 " + m.ai.processed + " 筆（輸入 " + m.ai.prompt_tokens + "、輸出 " + m.ai.completion_tokens + " tokens）。</p>";
    }
    h += "<h3>說明</h3><ul><li>「非正式・未查證」代表來自 PTT 或家教網的個人貼文，請自行確認對方身分，不要先付費或提供證件。</li>" +
      "<li>104 的日期是職缺「更新日」，不一定是首次刊登日；Yourator 只提供「一週內更新」這類相對時間。</li>" +
      "<li>收藏、狀態與備註只存在這個瀏覽器；請到「我的收藏」匯出備份。</li></ul>";
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
      if (u.fav[url]) { delete u.fav[url]; delete u.favJobs[url]; toast("已取消收藏"); }
      else {
        u.fav[url] = true;
        var j = state.jobs.filter(function (x) { return x.url === url; })[0];
        if (j) u.favJobs[url] = j; // 存一份快照，職缺過期後仍看得到
        toast("已加入收藏 ★");
      }
      saveUser(); el.classList.toggle("on", !!u.fav[url]); el.textContent = u.fav[url] ? "★" : "☆";
      if (!$("tab-favs").hidden) renderFavs();
    } else if (act === "status" && e.type === "change") {
      if (el.value) u.status[url] = el.value; else delete u.status[url];
      art.classList.toggle("no", el.value === "不考慮"); saveUser();
    } else if (act === "note" && e.type === "input") {
      if (el.value.trim()) u.note[url] = el.value; else delete u.note[url];
      clearTimeout(onCardEvent._t); onCardEvent._t = setTimeout(saveUser, 400);
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
        state.user = mergeUser(state.user, inc); saveUser(); renderFavs(); renderJobs();
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
