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
  const log = JSON.parse(await readFile(path.join(cacheDir, "jma-requests.json"), "utf8"));
  assert.equal(log.requests.length, 1);
  assert.equal(log.sends.length, 1);
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
  assert.equal(w.failCause, null, "上限のときは原因を付けない");
  assert.deepEqual(logs, [WEATHER_MESSAGES.limitNoCache]);
});

// 失敗の原因（画面の「原因：」の1行）。キャッシュなしで失敗させる。
for (const [name, handler, cause] of [
  ["404 → 地域コード", { status: 404, body: "" }, { kind: "area-unknown", code: "130000" }],
  ["つながらない → 接続", new TypeError("fetch failed"), { kind: "network" }],
  ["503 → 想定外の応答（番号つき）", { status: 503, body: "" }, { kind: "unexpected", status: 503 }],
  ["JSON が読めない → 想定外の応答（番号なし）", { status: 200, body: "<html>見本</html>" }, { kind: "unexpected", status: null }],
]) {
  test(`失敗の原因：${name}`, async (t) => {
    const d = await tempDir();
    t.after(d.cleanup);
    const cacheDir = await setup(d);
    const f = fakeFetch({ [FORECAST_URL("130000")]: handler });
    const { w } = await call(cacheDir, JST("2026-11-11T07:00:00"), f);
    assert.equal(w.state, "failed");
    assert.equal(w.failReason, "error");
    assert.deepEqual(w.failCause, cause);
  });
}

test("失敗の原因：area.json の offices に無い地域コードも「地域コード」", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d, { area: false });
  const f = fakeFetch({ [AREA_URL]: { body: areaJson() } });
  const w = await getWeather({ weather: { areaCode: "999999" }, cacheDir, timezone: "Asia/Tokyo", now: JST("2026-11-11T07:00:00"), fetchImpl: f, sleep: recordingSleep(), log: () => {} });
  assert.deepEqual(w.failCause, { kind: "area-unknown", code: "999999" });
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

const readLog = async (cacheDir) => JSON.parse(await readFile(path.join(cacheDir, "jma-requests.json"), "utf8"));

test("残りが1回でも再試行する（再試行は同じ取得の一部で、枠は1つだけ使う）", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const reqs = ["06:00", "09:00", "12:00"].map((h) => JST(`2026-11-11T${h}:00`).toISOString());
  const cacheDir = await setup(d, { requests: reqs });
  const f = fakeFetch({ [FORECAST_URL("130000")]: { status: 503, body: "" } });
  const { w, sleep } = await call(cacheDir, JST("2026-11-11T19:00:00"), f);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(sleep.waits, [60_000]);
  assert.equal(w.state, "failed");
  const log = await readLog(cacheDir);
  assert.equal(log.requests.length, 4, "枠は1つだけ使う");
  assert.equal(log.sends.length, 2, "実際の送信は2件として別に残す");
});

test("失敗の枠：予報の取得失敗1回（再試行込み）は枠を1つだけ使い、送信は2件と記録", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d);
  const f = fakeFetch({ [FORECAST_URL("130000")]: new TypeError("fetch failed") });
  const { w } = await call(cacheDir, JST("2026-11-11T06:12:00"), f);
  assert.equal(w.state, "failed");
  assert.equal(f.calls.length, 2);
  const log = await readLog(cacheDir);
  assert.equal(log.requests.length, 1);
  assert.equal(log.sends.length, 2);
});

test("失敗の枠：初回（area.json あり）に失敗しても、1実行で使う枠は2まで（送信は3件と記録）", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d, { area: false });
  const f = fakeFetch({ [AREA_URL]: { body: areaJson() }, [FORECAST_URL("130000")]: { status: 500, body: "" } });
  const { w } = await call(cacheDir, JST("2026-11-11T06:12:00"), f);
  assert.equal(w.state, "failed");
  assert.deepEqual(f.calls.map((c) => c.url), [AREA_URL, FORECAST_URL("130000"), FORECAST_URL("130000")]);
  const log = await readLog(cacheDir);
  assert.equal(log.requests.length, 2, "area.json 1 ＋ 予報 1（再試行込み）");
  assert.equal(log.sends.length, 3);
});

test("失敗の枠：失敗の実行を続けると、3回目の実行で4回の枠を使い切り（初回は area.json の分で2）、4回目は取りに行かない", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d, { area: false });
  const f = fakeFetch({ [AREA_URL]: { body: areaJson() }, [FORECAST_URL("130000")]: new TypeError("fetch failed") });
  const counts = [];
  for (const h of ["06:12", "07:12", "08:12", "09:12"]) {
    const { w, logs } = await call(cacheDir, JST(`2026-11-11T${h}:00`), f);
    const log = await readLog(cacheDir);
    counts.push([w.failReason, log.requests.length, log.sends.length, logs.at(-1)]);
  }
  assert.deepEqual(counts, [
    ["error", 2, 3, WEATHER_MESSAGES.failed], // area.json と予報（再試行込み）
    ["error", 3, 5, WEATHER_MESSAGES.failed],
    ["error", 4, 7, WEATHER_MESSAGES.failed],
    ["limit", 4, 7, WEATHER_MESSAGES.limitNoCache], // 4回目の実行は取りに行かない
  ]);
});

test("送信の記録（sends）は枠の判断に使わない：sends が多くても requests が4未満なら取りに行く", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d);
  const at = (h) => JST(`2026-11-11T${h}:00`).toISOString();
  await writeFile(path.join(cacheDir, "jma-requests.json"), JSON.stringify({ requests: [at("06:00"), at("09:00")], sends: ["06:00", "06:00", "09:00", "09:00", "09:00"].map(at) }));
  const f = fakeFetch({ [FORECAST_URL("130000")]: { body: jma1100() } });
  const { w } = await call(cacheDir, JST("2026-11-11T13:00:00"), f);
  assert.equal(w.state, "fresh");
  const log = await readLog(cacheDir);
  assert.equal(log.requests.length, 3);
  assert.equal(log.sends.length, 6);
});

test("キャッシュの3時間ちょうどは取りに行かず、1秒でも過ぎたら取りに行く", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const cacheDir = await setup(d, { cache: cacheOf(JST("2026-11-11T11:10:00")) });
  const f = fakeFetch({ [FORECAST_URL("130000")]: { body: jma1100() } });
  const exact = await call(cacheDir, JST("2026-11-11T14:10:00"), f);
  assert.equal(exact.w.state, "fresh");
  assert.equal(f.calls.length, 0, "3時間ちょうどはキャッシュ");
  const over = await call(cacheDir, JST("2026-11-11T14:10:01"), f);
  assert.equal(over.w.state, "fresh");
  assert.equal(f.calls.length, 1, "3時間を過ぎたら取りに行く");
  assert.equal(over.w.fetchedAt.toISOString(), JST("2026-11-11T14:10:01").toISOString());
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
