// 一次性工具：把舊的 Grok Bot 頁面 (jobs.canvas.tsx) 裡的職缺與公司清單轉成 docs/data/*.json
// 用法：node tools/seed_from_canvas.js /path/to/jobs.canvas.tsx
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");
const J = (code) => `https://www.104.com.tw/job/${code}`;
const OS = "未標示遠端（實體）";
function grab(name) {
  const i = src.indexOf(`const ${name}`);
  const s = src.indexOf("[", src.indexOf("=", i));
  let depth = 0, k = s, inStr = null;
  for (; k < src.length; k++) {
    const ch = src[k];
    if (inStr) { if (ch === "\\") { k++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "[") depth++;
    if (ch === "]") { depth--; if (depth === 0) break; }
  }
  return eval(src.slice(s, k + 1));
}
const CAT = { A: "設計與生涯", B: "藝術與諮詢", C: "一般工讀", D: "家教伴讀" };
const jobs = grab("JOBS").map((j) => {
  const date = j.d ? j.d.replace(/\//g, "-") : null;
  return {
    category: CAT[j.c], title: j.t, company: j.co, location: j.loc, type: j.ty,
    experience: j.exp || "未提供",
    workDays: j.days || "未提供", onsiteDays: j.onsite || "未提供",
    salary: j.pay || "未提供", date, dateText: j.dl || "", source: j.src, url: j.url,
    firstSeen: date || "2026-10-26",
    remote: !!j.remote, intern: !!j.intern, informal: !!j.informal,
    fitNote: j.fit || "", seed: true,
  };
});
const TY = { ux: "UX／產品團隊", agency: "UX 顧問公司", studio: "設計／插畫／動畫工作室", career: "生涯／諮商", edu: "教育／家教" };
const orgs = grab("ORGS").map((o) => ({ name: o.n, type: TY[o.ty], description: o.desc, location: o.loc, url: o.url, jobs: o.jobs || [] }));
fs.writeFileSync("docs/data/jobs.json", JSON.stringify({ updated: "2026-10-26T00:00:00+08:00", jobs }, null, 1));
fs.writeFileSync("docs/data/companies.json", JSON.stringify({ companies: orgs }, null, 1));
console.log("jobs", jobs.length, "companies", orgs.length);
