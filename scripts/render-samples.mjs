// 架空のデータで見本の画面を out/samples/ に書き出す（README の画像と画面の確認用）。通信しない。
// 使い方：node scripts/render-samples.mjs

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../src/render.mjs";
import { extractForecast } from "../src/weather/extract.mjs";
import { jma0500, jma1700 } from "../test/fixtures/jma.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "out", "samples");
const J = (s) => new Date(`${s}+09:00`);
const NOW = J("2026-11-11T06:12:00");

// 時刻の順は「発表 ≤ 取得 ≤ 作成」にそろえる（ありえない時刻を見本に出さない）。
// 新しい取得：発表 11-11 05:00、取得と作成 11-11 06:12。
const wx0500 = jma0500();
wx0500[0].timeSeries[1].areas[0].pops = ["10", "0", "20", "30", "40", "50", "30"];
const ex = extractForecast(wx0500, { areaName: "東京地方", tempPointName: "東京", today: "2026-11-11" });
const fresh = { state: "fresh", areaCode: "130000", failedAt: null, failReason: null, fetchedAt: J("2026-11-11T06:12:00"), ...ex };

// 前回取得分：発表 11-10 17:00、取得 11-10 18:20、作成 11-11 06:12（17:00 発表の形を1日前にずらす）。
const shiftDayBack = (v) => JSON.parse(JSON.stringify(v).replace(/2026-11-(\d{2})T/g, (_, d) => `2026-11-${String(Number(d) - 1).padStart(2, "0")}T`));
const wx1700 = shiftDayBack(jma1700());
wx1700[0].timeSeries[2].areas[0].temps = ["8", "17"];
const exStale = extractForecast(wx1700, { areaName: "東京地方", tempPointName: "東京", today: "2026-11-11" });
const stale = { state: "stale", areaCode: "130000", failedAt: null, failReason: null, fetchedAt: J("2026-11-10T18:20:00"), ...exStale };

const schedule = {
  state: "ok",
  partial: false,
  events: [
    { allDay: true, start: J("2026-11-11T00:00:00"), end: null, title: "終日の予定の例" },
    { allDay: false, start: J("2026-11-11T09:30:00"), end: J("2026-11-11T10:30:00"), title: "会議の例" },
    { allDay: false, start: J("2026-11-11T13:00:00"), end: J("2026-11-11T15:00:00"), title: "作業の例（題名が長いときは折り返して表示します。途中で切りません）" },
    { allDay: false, start: J("2026-11-11T18:00:00"), end: null, title: "買い物の例" },
  ],
};

const item = (n, h, desc = "") => ({ title: `見本の見出し ${n}：架空の記事の題名がここに入ります`, link: `https://example.com/articles/${n}`, publishedAt: J(h), description: desc });
const news = {
  feeds: [
    {
      name: "例のフィード A",
      state: "ok",
      items: [
        item(1, "2026-11-11T05:40:00", "架空の説明の例です。フィードの短い説明を100字までで区切って表示します。"),
        item(2, "2026-11-11T04:10:00"),
        item(3, "2026-11-10T22:05:00", "説明の例。"),
        item(4, "2026-11-10T19:30:00"),
        item(5, "2026-11-10T12:00:00"),
        item(6, "2026-11-10T09:00:00"),
      ],
    },
    { name: "例のフィード B", state: "ok", items: [item(7, "2026-11-11T06:00:00", "別のフィードの架空の説明。"), item(8, "2026-11-10T20:45:00")] },
  ],
};

const base = { version: "0.1.0", createdAt: NOW, timezone: "Asia/Tokyo", schedule: null, news: null, visibleItemsPerFeed: 4 };
const samples = {
  "weather-only": { ...base, weather: fresh },
  full: { ...base, weather: fresh, schedule, news },
  "weather-failed": { ...base, weather: { state: "failed", failReason: "error", failCause: { kind: "network" }, areaCode: "130000", failedAt: NOW, fetchedAt: null, office: null, reportDatetime: null, areaName: null, tempPointName: null, days: [] }, schedule, news },
  "weather-stale": { ...base, weather: stale, schedule },
};

// 見本の時刻の矛盾を防ぐ（発表 ≤ 取得 ≤ 作成）
for (const [name, view] of Object.entries(samples)) {
  const w = view.weather;
  if (w.state === "failed") continue;
  const report = Date.parse(w.reportDatetime);
  if (!(report <= w.fetchedAt.getTime() && w.fetchedAt.getTime() <= view.createdAt.getTime())) throw new Error(`見本の時刻の順が不自然です：${name}`);
}

await mkdir(outDir, { recursive: true });
for (const [name, view] of Object.entries(samples)) {
  await writeFile(path.join(outDir, `${name}.html`), render(view), "utf8");
  console.log(`out/samples/${name}.html`);
}
