/* 不需要 Supabase 帳號也能跑的檢查：合併規則、匯入、空設定、schema 與頁面接線。 */
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var api = require("../docs/app.js");

var root = path.join(__dirname, "..");
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }

function jwt(payload) {
  function b64(obj) {
    return Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return b64({ alg: "none", typ: "JWT" }) + "." + b64(payload) + ".sig";
}

function row(id, extra) {
  return Object.assign({
    job_id: id, favorite: false, status: null, note: null, fav_snapshot: null, updated_at: "2026-01-01T00:00:00.000Z"
  }, extra);
}

var failures = 0;
function check(name, fn) {
  try { fn(); console.log("ok  " + name); }
  catch (e) { failures++; console.error("FAIL " + name + "\n  " + (e && e.stack || e)); }
}

check("empty config stays local-only", function () {
  assert.strictEqual(api.isSupabaseConfigured(null), false);
  assert.strictEqual(api.isSupabaseConfigured({}), false);
  assert.strictEqual(api.isSupabaseConfigured({ url: "", anonKey: "" }), false);
  assert.strictEqual(api.isSupabaseConfigured({ url: "  ", anonKey: "  " }), false);
  assert.strictEqual(api.supabaseConfigError({ url: "", anonKey: "" }), "");
});

check("committed config uses the publishable key", function () {
  var ctx = { window: {} };
  vm.runInNewContext(read("docs/config.js"), ctx);
  var cfg = ctx.window.JOB_TRACKER_SUPABASE;
  assert.strictEqual(cfg.url, "https://vmyitibdkkguzgqwsrbc.supabase.co");
  assert.ok(/^sb_publishable_/.test(cfg.anonKey));
  assert.strictEqual(api.looksLikeServiceRole(cfg.anonKey), false);
  assert.strictEqual(api.isSupabaseConfigured(cfg), true);
  assert.strictEqual(api.supabaseConfigError(cfg), "");
});

check("rejects partial, insecure, and service-role config", function () {
  assert.ok(api.supabaseConfigError({ url: "https://abc.supabase.co", anonKey: "" }));
  assert.strictEqual(api.isSupabaseConfigured({ url: "http://abc.supabase.co", anonKey: "anon" }), false);
  var secret = jwt({ role: "service_role" });
  assert.strictEqual(api.looksLikeServiceRole(secret), true);
  assert.strictEqual(api.isSupabaseConfigured({ url: "https://abc.supabase.co", anonKey: secret }), false);
  assert.ok(/service_role/.test(api.supabaseConfigError({ url: "https://abc.supabase.co", anonKey: secret })));
  assert.strictEqual(api.looksLikeServiceRole("sb_secret_example"), true);
  assert.strictEqual(api.isSupabaseConfigured({ url: "https://abc.supabase.co", anonKey: "sb_secret_example" }), false);
  assert.ok(/secret/.test(api.supabaseConfigError({ url: "https://abc.supabase.co", anonKey: "sb_secret_example" })));
  assert.strictEqual(api.looksLikeServiceRole(jwt({ role: "anon" })), false);
  assert.strictEqual(api.isSupabaseConfigured({ url: "https://abc.supabase.co/", anonKey: jwt({ role: "anon" }) }), true);
  assert.strictEqual(api.isSupabaseConfigured({ url: "https://abc.supabase.co", anonKey: "sb_publishable_test" }), true);
  assert.strictEqual(api.isSupabaseConfigured({
    url: "https://abc.supabase.co",
    anonKey: "sb_publishable_5bRHv6VKJ04aJ_3fLTatgw_0fJxoRUZ"
  }), true);
  assert.strictEqual(api.normalizeSupabaseUrl("https://abc.supabase.co/"), "https://abc.supabase.co");
});

check("existing filters and import merge still work", function () {
  var jobs = [
    { url: "https://a.example/1", title: "行政", company: "甲", category: "一般工讀", source: "104", salary: "時薪 200", remote: true },
    { url: "https://a.example/2", title: "設計", company: "乙", category: "設計與生涯", source: "Yourator", salary: "月薪 40000" }
  ];
  var user = { fav: {}, status: { "https://a.example/2": "不考慮" }, note: { "https://a.example/1": "下午班" }, favJobs: {}, updated: {} };
  var found = api.filterJobs(jobs, { q: "下午", remote: true, hideNo: true }, user, Date.now());
  assert.deepStrictEqual(found.map(function (j) { return j.url; }), ["https://a.example/1"]);
  assert.ok(api.payNumber("月薪 40,000") > api.payNumber("時薪 200"));
  var merged = api.mergeUser(
    { fav: { a: true }, status: { a: "想投" }, note: {}, favJobs: {} },
    { fav: { b: true }, status: { a: "已投" }, note: { b: "備註" } }
  );
  assert.strictEqual(merged.fav.a, true);
  assert.strictEqual(merged.fav.b, true);
  assert.strictEqual(merged.status.a, "已投");
  assert.strictEqual(merged.note.b, "備註");
  var imported = api.applyImport(
    { fav: { c: true }, status: {}, note: {}, favJobs: {}, updated: { c: "2020-01-01T00:00:00.000Z" } },
    { fav: { b: true }, status: { a: "面試" }, note: {}, favJobs: { b: { url: "b", title: "乙" } } },
    "2026-10-26T00:00:00.000Z"
  );
  assert.strictEqual(imported.fav.c, true);
  assert.strictEqual(imported.updated.c, "2020-01-01T00:00:00.000Z");
  assert.strictEqual(imported.status.a, "面試");
  assert.strictEqual(imported.updated.b, "2026-10-26T00:00:00.000Z");
  assert.strictEqual(imported.updated.a, "2026-10-26T00:00:00.000Z");
});

check("不考慮 stays last and unseen precedes seen", function () {
  var jobs = [
    { url: "old-seen", title: "甲", company: "A", date: "2026-01-01", firstSeen: "2026-01-01", salary: "時薪 100" },
    { url: "new-unseen", title: "乙", company: "B", date: "2026-10-01", firstSeen: "2026-10-01", salary: "時薪 300" },
    { url: "mid-seen", title: "丙", company: "C", date: "2026-06-01", firstSeen: "2026-06-01", salary: "時薪 200" },
    { url: "no", title: "丁", company: "D", date: "2026-12-01", firstSeen: "2026-12-01", salary: "月薪 80000" }
  ];
  var user = {
    fav: {}, status: { no: "不考慮" }, note: {}, favJobs: {},
    seen: { "old-seen": "2026-02-01T00:00:00.000Z", "mid-seen": "2026-07-01T00:00:00.000Z" },
    updated: {}
  };
  ["date", "first", "company", "title", "pay"].forEach(function (key) {
    var urls = api.sortJobs(jobs, key, user).map(function (j) { return j.url; });
    assert.strictEqual(urls[urls.length - 1], "no", key + " " + urls.join(","));
    var flags = urls.slice(0, -1).map(function (u) { return user.seen[u] ? 1 : 0; });
    for (var i = 1; i < flags.length; i++) assert.ok(flags[i - 1] <= flags[i], key + " " + urls.join(","));
  });
  assert.deepStrictEqual(api.sortJobs(jobs, "date", user).map(function (j) { return j.url; }), ["new-unseen", "mid-seen", "old-seen", "no"]);
  var hidden = api.filterJobs(jobs, {
    q: "", cat: "", src: "", status: "", fit: "", sal: "", remote: false, intern: false, days: false, isNew: false, hideNo: true
  }, user, Date.now());
  assert.deepStrictEqual(hidden.map(function (j) { return j.url; }).indexOf("no"), -1);
  var seenUser = api.userFromRows([row("a", { seen_at: "2026-04-01T00:00:00.000Z", updated_at: "2026-04-01T00:00:00.000Z" })]);
  assert.strictEqual(seenUser.seen.a, "2026-04-01T00:00:00.000Z");
  assert.strictEqual(api.rowsFromUser(seenUser)[0].seen_at, "2026-04-01T00:00:00.000Z");
  var imported = api.applyImport(
    { fav: {}, status: {}, note: {}, favJobs: {}, seen: {}, updated: {} },
    { fav: {}, status: {}, note: {}, favJobs: {}, seen: { x: "2026-03-01T00:00:00.000Z" } },
    "2026-10-26T00:00:00.000Z"
  );
  assert.strictEqual(imported.seen.x, "2026-03-01T00:00:00.000Z");
  assert.strictEqual(imported.updated.x, "2026-10-26T00:00:00.000Z");
  var kept = api.planSync(
    { fav: {}, status: {}, note: {}, favJobs: {}, seen: { a: "2026-09-01T00:00:00.000Z" }, updated: { a: "2026-09-01T00:00:00.000Z" } },
    [row("a", { updated_at: "2026-01-01T00:00:00.000Z" })],
    "2026-10-01T00:00:00.000Z"
  );
  assert.strictEqual(kept.merged.seen.a, "2026-09-01T00:00:00.000Z");
  var newer = api.planSync(
    { fav: {}, status: {}, note: {}, favJobs: {}, seen: { a: "2026-01-01T00:00:00.000Z" }, updated: { a: "2026-01-01T00:00:00.000Z" } },
    [row("a", { seen_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z" })],
    "2026-10-01T00:00:00.000Z"
  );
  assert.strictEqual(newer.merged.seen.a, "2026-08-01T00:00:00.000Z");
  var considerJobs = [
    { url: "plain", title: "甲", company: "A", date: "2026-01-01", salary: "時薪 100" },
    { url: "consider", title: "乙", company: "B", date: "2026-12-01", salary: "時薪 200" },
    { url: "no", title: "丙", company: "C", date: "2026-11-01", salary: "時薪 900" }
  ];
  var considerUser = { fav: {}, status: { consider: "考慮", no: "不考慮" }, note: {}, favJobs: {}, seen: {}, updated: {} };
  assert.deepStrictEqual(api.sortJobs(considerJobs, "date", considerUser).map(function (j) { return j.url; }), ["consider", "plain", "no"]);
  assert.deepStrictEqual(api.filterJobs(considerJobs, { status: "考慮" }, considerUser, Date.now()).map(function (j) { return j.url; }), ["consider"]);
  var round = api.userFromRows([row("consider", { status: "考慮", updated_at: "2026-04-01T00:00:00.000Z" })]);
  assert.strictEqual(round.status.consider, "考慮");
  assert.strictEqual(api.rowsFromUser(round)[0].status, "考慮");
  var importedConsider = api.applyImport(
    { fav: {}, status: {}, note: {}, favJobs: {}, seen: {}, updated: {} },
    { fav: {}, status: { consider: "考慮" }, note: {}, favJobs: {}, seen: {} },
    "2026-10-26T00:00:00.000Z"
  );
  assert.strictEqual(importedConsider.status.consider, "考慮");
});

check("first login uploads local jobs and keeps cloud-only jobs", function () {
  var now = "2026-10-26T03:00:00.000Z";
  var local = {
    fav: { "https://job/local": true },
    status: { "https://job/local": "想投" },
    note: { "https://job/local": "本機備註" },
    favJobs: { "https://job/local": { url: "https://job/local", title: "本機" } }
  };
  var remote = [row("https://job/cloud", { favorite: true, status: "已投", note: "雲端", updated_at: "2026-10-20T00:00:00.000Z", fav_snapshot: { url: "https://job/cloud", title: "雲端" } })];
  var plan = api.planSync(local, remote, now);
  assert.strictEqual(plan.merged.fav["https://job/local"], true);
  assert.strictEqual(plan.merged.status["https://job/local"], "想投");
  assert.strictEqual(plan.merged.note["https://job/local"], "本機備註");
  assert.strictEqual(plan.merged.fav["https://job/cloud"], true);
  assert.strictEqual(plan.merged.status["https://job/cloud"], "已投");
  assert.strictEqual(plan.merged.note["https://job/cloud"], "雲端");
  assert.deepStrictEqual(plan.upserts.map(function (r) { return r.job_id; }), ["https://job/local"]);
  assert.deepStrictEqual(plan.deletes, []);
  var again = api.planSync(plan.merged, remote.concat(plan.upserts), "2026-10-26T04:00:00.000Z");
  assert.deepStrictEqual(again.upserts, []);
  assert.deepStrictEqual(again.deletes, []);
});

check("newer per-job edit wins, including an explicit clear", function () {
  var local = {
    fav: { a: true },
    status: { a: "想投", b: "面試" },
    note: { b: "舊備註" },
    favJobs: {},
    updated: { a: "2026-01-01T00:00:00.000Z", b: "2026-01-01T00:00:00.000Z" }
  };
  var remote = [
    row("a", { favorite: false, status: "已投", updated_at: "2026-06-01T00:00:00.000Z" }),
    row("b", { status: "面試", note: null, updated_at: "2026-08-01T00:00:00.000Z" })
  ];
  var plan = api.planSync(local, remote, "2026-10-01T00:00:00.000Z");
  assert.strictEqual(plan.merged.fav.a, undefined);
  assert.strictEqual(plan.merged.status.a, "已投");
  assert.strictEqual(plan.upserts.length, 0);
  assert.strictEqual(plan.merged.status.b, "面試");
  assert.strictEqual(plan.merged.note.b, undefined);
  assert.strictEqual(plan.upserts.filter(function (r) { return r.job_id === "b"; }).length, 0);
});

check("legacy local fields are not dropped on first merge", function () {
  var local = { fav: { a: true }, status: {}, note: { a: "只在這台" }, favJobs: { a: { title: "甲" } } };
  var remote = [row("a", { favorite: false, status: "已投", updated_at: "2026-06-01T00:00:00.000Z" })];
  var plan = api.planSync(local, remote, "2026-10-26T00:00:00.000Z");
  assert.strictEqual(plan.merged.fav.a, true);
  assert.strictEqual(plan.merged.status.a, "已投");
  assert.strictEqual(plan.merged.note.a, "只在這台");
  assert.strictEqual(plan.merged.updated.a, "2026-10-26T00:00:00.000Z");
  assert.strictEqual(plan.upserts.length, 1);
  assert.strictEqual(plan.upserts[0].favorite, true);
  assert.strictEqual(plan.upserts[0].note, "只在這台");
});

check("two legacy devices keep both sides and prefer local on conflict", function () {
  var local = { fav: { a: true }, status: { a: "想投" }, note: {}, favJobs: {} };
  var remoteUser = { fav: {}, status: { a: "已投" }, note: { a: "雲端備註" }, favJobs: {}, updated: {} };
  var merged = api.mergeProgress(local, remoteUser, "2026-10-26T00:00:00.000Z");
  assert.strictEqual(merged.fav.a, true);
  assert.strictEqual(merged.status.a, "想投");
  assert.strictEqual(merged.note.a, "雲端備註");
});

check("timestamp formatting and snapshot key order do not rewrite the cloud", function () {
  var snap = { url: "a", title: "甲", company: "乙" };
  var local = api.userFromRows([row("a", {
    favorite: true, note: "hi", fav_snapshot: snap, updated_at: "2026-05-01T08:00:00.000Z"
  })]);
  var remote = [row("a", {
    favorite: true,
    note: "hi",
    fav_snapshot: { company: "乙", title: "甲", url: "a" },
    updated_at: "2026-05-01T08:00:00.123000+00:00"
  })];
  // 不同的毫秒不是同一筆；這裡用相同的毫秒值。
  remote[0].updated_at = "2026-05-01T08:00:00+00:00";
  var plan = api.planSync(local, remote, "2026-10-01T00:00:00.000Z");
  assert.deepStrictEqual(plan.upserts, []);
  assert.deepStrictEqual(plan.deletes, []);
});

check("rows round-trip and invalid status is ignored", function () {
  var user = api.userFromRows([
    row("a", { favorite: true, status: "不考慮", note: "n", fav_snapshot: { title: "T" }, updated_at: "2026-01-02T00:00:00.000Z" }),
    row("b", { status: "不是狀態", note: "只留備註", updated_at: "2026-01-02T00:00:00.000Z" })
  ]);
  assert.strictEqual(user.status.a, "不考慮");
  assert.strictEqual(user.status.b, undefined);
  assert.strictEqual(user.note.b, "只留備註");
  assert.strictEqual(user.favJobs.a.title, "T");
  var rows = api.rowsFromUser(user);
  assert.strictEqual(rows.length, 2);
  var back = api.userFromRows(rows);
  assert.strictEqual(back.fav.a, true);
  assert.strictEqual(back.note.b, "只留備註");
});

check("other device pulls cloud data into an empty browser", function () {
  var cloud = [row("a", { favorite: true, status: "面試", note: "電話", fav_snapshot: { title: "甲", url: "a" }, updated_at: "2026-04-01T00:00:00.000Z" })];
  var plan = api.planSync({ fav: {}, status: {}, note: {}, favJobs: {}, updated: {} }, cloud, "2026-10-01T00:00:00.000Z");
  assert.strictEqual(plan.merged.fav.a, true);
  assert.strictEqual(plan.merged.status.a, "面試");
  assert.strictEqual(plan.merged.note.a, "電話");
  assert.strictEqual(plan.merged.favJobs.a.title, "甲");
  assert.deepStrictEqual(plan.upserts, []);
});

check("page wires config, keeps sync hidden, and schema locks rows to the user", function () {
  var html = read("docs/index.html");
  var configAt = html.indexOf('src="config.js"');
  var appAt = html.indexOf('src="app.js"');
  assert.ok(configAt > 0 && appAt > configAt);
  assert.ok(/id="syncbar"[^>]*hidden/.test(html));
  assert.ok(html.indexOf("supabase.co") < 0);
  assert.ok(html.indexOf("只存在這台裝置的瀏覽器裡") > 0);
  var schema = read("supabase/schema.sql");
  assert.ok(/enable row level security/i.test(schema));
  assert.ok(/force row level security/i.test(schema));
  assert.ok(/\(select auth\.uid\(\)\) = user_id/.test(schema));
  ["select", "insert", "update", "delete"].forEach(function (op) {
    assert.ok(new RegExp("for " + op + "[\\s\\S]*to authenticated", "i").test(schema));
  });
  assert.ok(/revoke all on table public\.job_progress from public, anon/i.test(schema));
  assert.ok(/grant select, insert, update, delete on table public\.job_progress to authenticated/i.test(schema));
  assert.ok(!/to anon/i.test(schema));
  assert.ok(/service_role/.test(schema));
  var workflow = read(".github/workflows/update.yml");
  assert.ok(workflow.indexOf("supabase") < 0);
  assert.ok(workflow.indexOf("python -m scraper.run") > 0);
  var js = read("docs/app.js");
  assert.strictEqual(js.indexOf("service_role_key"), -1);
  assert.ok(js.indexOf("signInWithOtp") > 0);
  assert.ok(js.indexOf("verifyOtp") > 0);
  assert.ok(js.indexOf("signInWithPassword") > 0);
  assert.ok(js.indexOf("updateUser") > 0);
  assert.ok(js.indexOf('flowType: "implicit"') > 0);
  assert.ok(js.indexOf('scope: "local"') > 0);
  assert.strictEqual(js.indexOf('flowType: "pkce"'), -1);
  assert.strictEqual(js.indexOf("localStorage.setItem(\"password\""), -1);
  assert.ok(js.indexOf("jerry-job-tracker-v1") > 0);
  assert.ok(html.indexOf("6 位數驗證碼") > 0);
  assert.ok(html.indexOf('id="syncCode"') > 0);
  assert.ok(html.indexOf("用密碼登入") > 0);
  assert.ok(html.indexOf("設定密碼") > 0);
  assert.ok(html.indexOf('id="syncSetPassword"') > 0);
  var readme = read("README.md");
  assert.ok(readme.indexOf("不用改 Supabase 的信件範本") > 0);
  assert.ok(readme.indexOf("一定要包含 `https://`") > 0);
  assert.strictEqual(api.authRedirectUrl("https://job-tracker-docs.vercel.app/index.html?x=1#favs"), "https://job-tracker-docs.vercel.app");
  assert.strictEqual(api.authRedirectUrl("http://localhost:8000/docs/"), "http://localhost:8000");
  assert.strictEqual(api.authRedirectUrl("http://127.0.0.1:8000/"), "http://127.0.0.1:8000");
  assert.strictEqual(api.authRedirectUrl("http://job-tracker-docs.vercel.app/"), "");
  assert.strictEqual(api.authRedirectUrl("job-tracker-docs.vercel.app"), "");
  assert.ok(readme.indexOf("設定密碼") > 0);
  assert.strictEqual(readme.indexOf("信件範本一定要改"), -1);
});

check("login link can be opened on a different device", function () {
  assert.deepStrictEqual(api.otpTypesToTry(""), ["email", "signup", "magiclink"]);
  assert.deepStrictEqual(api.otpTypesToTry("signup"), ["signup", "email", "magiclink"]);
  assert.deepStrictEqual(api.otpTypesToTry("magiclink"), ["magiclink", "email", "signup"]);
  assert.deepStrictEqual(api.otpTypesToTry("email"), ["email", "signup", "magiclink"]);
  var href = "https://job-tracker-docs.vercel.app/?token_hash=abc%2Bdef&type=signup#favs";
  var parsed = api.parseAuthCallback(href);
  assert.strictEqual(parsed.tokenHash, "abc+def");
  assert.strictEqual(parsed.type, "signup");
  assert.strictEqual(parsed.code, "");
  assert.strictEqual(api.stripAuthParams(href), "/#favs");
  var pkce = api.parseAuthCallback("https://job-tracker-docs.vercel.app/?code=from-other-browser#favs");
  assert.strictEqual(pkce.code, "from-other-browser");
  assert.strictEqual(pkce.tokenHash, "");
  assert.strictEqual(api.stripAuthParams("https://job-tracker-docs.vercel.app/?code=from-other-browser#favs"), "/#favs");
  var implicit = api.parseAuthCallback("https://job-tracker-docs.vercel.app/#access_token=tok&refresh_token=r&expires_in=3600&token_type=bearer&type=signup");
  assert.strictEqual(implicit.accessToken, "tok");
  assert.strictEqual(implicit.refreshToken, "r");
  assert.strictEqual(api.stripAuthParams("https://job-tracker-docs.vercel.app/#access_token=tok&refresh_token=r"), "/");
  var failed = api.parseAuthCallback("https://job-tracker-docs.vercel.app/?error_description=Email+link+is+invalid+or+has+expired");
  assert.ok(/expired/i.test(failed.error));
  assert.ok(/密碼登入/.test(api.authFailureMessage({ message: failed.error })));
  assert.ok(/這台裝置/.test(api.authFailureMessage({ message: "Not a valid implicit grant flow url." })));
  assert.ok(/設定密碼/.test(api.authFailureMessage({ message: "Invalid login credentials" })));
  assert.strictEqual(api.authFailureMessage({ message: "Password should be at least 6 characters" }), "密碼至少要 6 個字");
  assert.strictEqual(api.shouldRetryOtp({ message: "Token has expired or is invalid" }), true);
  assert.strictEqual(api.shouldRetryOtp({ message: "Request rate limit reached" }), false);
  assert.strictEqual(api.shouldRetryOtp({ message: "Failed to fetch" }), false);
});

if (failures) {
  console.error("\n" + failures + " failed");
  process.exit(1);
}
console.log("\nall checks passed");
