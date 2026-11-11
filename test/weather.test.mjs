import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { AREA_URL, FORECAST_URL, getWeather, WEATHER_MESSAGES } from "../src/weather/index.mjs";
import { areaJson, jma1100 } from "./fixtures/jma.mjs";
import { fakeFetch, JST, recordingSleep, tempDir } from "./helpers.mjs";

const weather = { areaCode: "130000", areaName: "東京地方", tempPointName: "東京" };

async function setup(t, { cache, requests, area = true } = {}) {
  const cacheDir = path.join(t.dir, ".cache");
  await mkdir(cacheDir, { recursive: true });
  if (cache) await writeFile(path.join(cacheDir, "weather-130000.json"), JSON.stringify(cache));
  if (requests) await writeFile(path.join(cacheDir, "jma-requests.json"), JSON.stringify({ requests }));
  if (area) await writeFile(path.join(cacheDir, "area.json"), JSON.stringify({ lastAreaCode: "130000", offices: ["130000"] }));
  return cacheDir;
}

function call(cacheDir, now, fetchImpl, extra = {}) {
  const logs = [];
  const sleep = recordingSleep();
  const p = getWeather({ weather, cacheDir, timezone: "Asia/Tokyo", now, fetchImpl, sleep, log: (m) => logs.push(m), ...extra });
  return p.then((w) => ({ w, logs, sleep }));
}

const cacheOf = (fetchedAt, report = "2026-11-11T11:00:00+09:00") => {
  const body = jma1100();
  body[0].reportDatetime = report;
  return { areaCode: "130000", fetchedAt: new Date(fetchedAt).toISOString(), reportDatetime: report, body };
};

test("新しく取得：fresh、キャッシュと回数の記録を書く", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d);
  const f = fakeFetch({ [FORECAST_URL("130000")]: { body: jma1100() } });
  const { w, logs } = await call(cacheDir, JST("2026-11-11T11:12:00"), f);
  assert.equal(w.state, "fresh");
  assert.equal(w.office, "気象庁");
  assert.equal(w.fetchedAt.toISOString(), JST("2026-11-11T11:12:00").toISOString());
  assert.deepEqual(logs, [WEATHER_MESSAGES.fetching]);
  assert.equal(f.calls.length, 1, "1回の実行で予報の JSON は1本だけ");
  const saved = JSON.parse(await readFile(path.join(cacheDir, "weather-130000.json"), "utf8"));
  assert.equal(saved.reportDatetime, "2026-11-11T11:00:00+09:00");
  const reqs = JSON.parse(await readFile(path.join(cacheDir, "jma-requests.json"), "utf8")).requests;
  assert.equal(reqs.length, 1);
});

test("3時間以内のキャッシュがあれば取りに行かない（印なし）", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d, { cache: cacheOf(JST("2026-11-11T11:10:00")) });
  const f = fakeFetch({});
  const { w } = await call(cacheDir, JST("2026-11-11T14:00:00"), f);
  assert.equal(w.state, "fresh");
  assert.equal(f.calls.length, 0);
});

test("失敗して24時間以内（発表から）のキャッシュがあれば前回取得分", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d, { cache: cacheOf(JST("2026-11-10T18:20:00"), "2026-11-10T17:00:00+09:00") });
  const f = fakeFetch({ [FORECAST_URL("130000")]: { status: 500, body: "" } });
  const { w, logs, sleep } = await call(cacheDir, JST("2026-11-11T06:12:00"), f);
  assert.equal(w.state, "stale");
  assert.equal(w.fetchedAt.toISOString(), JST("2026-11-10T18:20:00").toISOString());
  assert.equal(f.calls.length, 2, "再試行は1回だけ");
  assert.deepEqual(sleep.waits, [60_000], "気象庁の再試行は60秒あける");
  assert.ok(logs.includes(WEATHER_MESSAGES.failed));
});

test("24時間を超えたキャッシュは出さない", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d, { cache: cacheOf(JST("2026-11-10T06:00:00"), "2026-11-10T05:00:00+09:00") });
  const f = fakeFetch({ [FORECAST_URL("130000")]: new TypeError("fetch failed") });
  const { w } = await call(cacheDir, JST("2026-11-11T06:12:00"), f);
  assert.equal(w.state, "failed");
  assert.equal(w.failReason, "error");
});

test("取得は24時間以内でも、発表から24時間を超えるキャッシュは出さない", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d, { cache: cacheOf(JST("2026-11-11T02:00:00"), "2026-11-10T05:00:00+09:00") });
  const f = fakeFetch({ [FORECAST_URL("130000")]: new TypeError("fetch failed") });
  const { w } = await call(cacheDir, JST("2026-11-11T06:12:00"), f);
  assert.equal(w.state, "failed");
});

test("上限（4回）でキャッシュなし：取りに行かず、上限の文言", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const reqs = ["06:00", "09:00", "12:00", "15:00"].map((h) => JST(`2026-11-11T${h}:00`).toISOString());
  const cacheDir = await setup(d, { requests: reqs });
  const f = fakeFetch({});
  const { w, logs } = await call(cacheDir, JST("2026-11-11T19:00:00"), f);
  assert.equal(f.calls.length, 0);
  assert.equal(w.state, "failed");
  assert.equal(w.failReason, "limit");
  assert.deepEqual(logs, [WEATHER_MESSAGES.limitNoCache]);
});

test("上限で24時間以内のキャッシュあり：前回取得分を使う文言", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const reqs = ["06:00", "09:00", "12:00", "15:00"].map((h) => JST(`2026-11-11T${h}:00`).toISOString());
  const cacheDir = await setup(d, { requests: reqs, cache: cacheOf(JST("2026-11-11T15:00:00")) });
  const f = fakeFetch({});
  const { w, logs } = await call(cacheDir, JST("2026-11-11T19:00:00"), f);
  assert.equal(f.calls.length, 0);
  assert.equal(w.state, "stale");
  assert.deepEqual(logs, [WEATHER_MESSAGES.limitWithCache]);
});

test("残りが1回なら再試行しない（再試行も1回に数える）", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const reqs = ["06:00", "09:00", "12:00"].map((h) => JST(`2026-11-11T${h}:00`).toISOString());
  const cacheDir = await setup(d, { requests: reqs });
  const f = fakeFetch({ [FORECAST_URL("130000")]: { status: 503, body: "" } });
  const { w, sleep } = await call(cacheDir, JST("2026-11-11T19:00:00"), f);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(sleep.waits, []);
  assert.equal(w.state, "failed");
  const saved = JSON.parse(await readFile(path.join(cacheDir, "jma-requests.json"), "utf8")).requests;
  assert.equal(saved.length, 4);
});

test("404 は再試行せず、地域コードの文言", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d);
  const f = fakeFetch({ [FORECAST_URL("130000")]: { status: 404, body: "" } });
  const { w, logs, sleep } = await call(cacheDir, JST("2026-11-11T07:00:00"), f);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(sleep.waits, []);
  assert.equal(w.state, "failed");
  assert.ok(logs.includes("地域コード 130000 が気象庁のデータにありません。weather.areaCode を確かめてください。"));
});

test("初回は area.json を1回取り、offices に無い地域コードなら予報を取りに行かない", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d, { area: false });
  const f = fakeFetch({ [AREA_URL]: { body: areaJson() }, [FORECAST_URL("999999")]: { body: jma1100() } });
  const logs = [];
  const w = await getWeather({ weather: { areaCode: "999999" }, cacheDir, timezone: "Asia/Tokyo", now: JST("2026-11-11T07:00:00"), fetchImpl: f, sleep: recordingSleep(), log: (m) => logs.push(m) });
  assert.equal(w.state, "failed");
  assert.deepEqual(f.calls.map((c) => c.url), [AREA_URL]);
  assert.ok(logs.includes("地域コード 999999 が気象庁のデータにありません。weather.areaCode を確かめてください。"));
  const reqs = JSON.parse(await readFile(path.join(cacheDir, "jma-requests.json"), "utf8")).requests;
  assert.equal(reqs.length, 1, "area.json も回数に入る");
});

test("area.json は2回目からは取らない", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d, { area: false });
  const f = fakeFetch({ [AREA_URL]: { body: areaJson() }, [FORECAST_URL("130000")]: { body: jma1100() } });
  await call(cacheDir, JST("2026-11-11T07:00:00"), f);
  await call(cacheDir, JST("2026-11-11T10:30:00"), f);
  assert.deepEqual(f.calls.map((c) => c.url), [AREA_URL, FORECAST_URL("130000"), FORECAST_URL("130000")]);
});

test("地域コードを変えると前の地域のキャッシュを使わない", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d, { cache: cacheOf(JST("2026-11-11T11:10:00")) });
  await writeFile(path.join(cacheDir, "area.json"), JSON.stringify({ lastAreaCode: "270000", offices: ["130000", "270000"] }));
  const f = fakeFetch({ [FORECAST_URL("270000")]: new TypeError("fetch failed") });
  const w = await getWeather({ weather: { areaCode: "270000" }, cacheDir, timezone: "Asia/Tokyo", now: JST("2026-11-11T12:00:00"), fetchImpl: f, sleep: recordingSleep(), log: () => {} });
  assert.equal(w.state, "failed");
  assert.equal(w.areaCode, "270000");
});

test("新しく取れても発表が24時間より古いときは出し、コンソールで知らせる", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d);
  const body = jma1100();
  body[0].reportDatetime = "2026-11-09T17:00:00+09:00";
  const f = fakeFetch({ [FORECAST_URL("130000")]: { body } });
  const { w, logs } = await call(cacheDir, JST("2026-11-11T07:00:00"), f);
  assert.equal(w.state, "fresh");
  assert.equal(w.reportDatetime, "2026-11-09T17:00:00+09:00");
  assert.ok(logs.includes("気象庁の発表が24時間より古いままです（発表：2026-11-09 17:00）。"));
});

test("壊れたキャッシュのファイルは無いものとして扱う", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d);
  await writeFile(path.join(cacheDir, "weather-130000.json"), "{ broken");
  const f = fakeFetch({ [FORECAST_URL("130000")]: { body: jma1100() } });
  const { w } = await call(cacheDir, JST("2026-11-11T11:30:00"), f);
  assert.equal(w.state, "fresh");
  assert.equal(f.calls.length, 1);
});
