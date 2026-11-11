import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConfigError, loadConfig, normalizeConfig } from "../src/config.mjs";
import { tempDir, writeConfig } from "./helpers.mjs";

test("config.example.json はそのままで読め、天気だけの設定になる", async () => {
  const file = new URL("../config.example.json", import.meta.url);
  const raw = JSON.parse(await readFile(file, "utf8"));
  const { config, notices } = normalizeConfig(raw, "/base");
  assert.equal(config.weather.areaCode, "130000");
  assert.equal(config.schedule.enabled, false);
  assert.deepEqual(config.feeds, []); // URL が空のフィードは飛ばす
  assert.deepEqual(notices, []);
  assert.equal("summary" in raw, false, "初版の設定に summary は無い");
});

test("config.example.json に個人の値（URL、メール、絶対パス）が無い", async () => {
  const text = await readFile(new URL("../config.example.json", import.meta.url), "utf8");
  assert.doesNotMatch(text, /https?:\/\//);
  assert.doesNotMatch(text, /@[\w.-]+\./);
  assert.doesNotMatch(text, /[A-Za-z]:\\|\/Users\/|\/home\//);
});

test("ファイルが無いと決まった文言", async () => {
  const t = await tempDir();
  try {
    await assert.rejects(loadConfig(path.join(t.dir, "config.json")), (e) => e instanceof ConfigError && e.message === "config.json が見つかりません。config.example.json を config.json という名前でコピーしてください。");
  } finally {
    await t.cleanup();
  }
});

test("JSON が壊れていると行番号つきの文言", async () => {
  const t = await tempDir();
  try {
    const file = await writeConfig(t.dir, '{\n  "weather": {\n    "areaCode": "130000"\n  },,\n}\n');
    await assert.rejects(loadConfig(file), (e) => e instanceof ConfigError && /^config\.json の 4 行目付近を確かめてください（JSON として読めません）。$/.test(e.message));
  } finally {
    await t.cleanup();
  }
});

test("地域コードが空なら止める", () => {
  assert.throws(() => normalizeConfig({ weather: { areaCode: "" } }, "/b"), (e) => e instanceof ConfigError && e.message.startsWith("weather.areaCode が設定されていません。"));
  assert.throws(() => normalizeConfig({}, "/b"), ConfigError);
});

test("地域コードが6桁の数字でなければ止める", () => {
  assert.throws(() => normalizeConfig({ weather: { areaCode: "13000" } }, "/b"), (e) => e.message === "地域コード 13000 が気象庁のデータにありません。weather.areaCode を確かめてください。");
});

test("相対パスは設定ファイルのフォルダが基準。既定値が入る", () => {
  const base = path.resolve("/some/base");
  const { config } = normalizeConfig({ weather: { areaCode: "130000" } }, base);
  assert.equal(config.outputPath, path.join(base, "out", "morning-brief.html"));
  assert.equal(config.cacheDir, path.join(base, ".cache"));
  assert.equal(config.timezone, "Asia/Tokyo");
  assert.deepEqual(config.rss, { sinceHour: 6, visibleItemsPerFeed: 4, maxItemsPerFeed: 10 });
  assert.equal(config.schedule.icalUrlEnv, "MORNING_BRIEF_ICAL_URL");
});

test("おかしな値は既定値に戻して知らせる", () => {
  const { config, notices } = normalizeConfig({ weather: { areaCode: "130000" }, rss: { sinceHour: 30 }, timezone: "Not/AZone" }, "/b");
  assert.equal(config.rss.sinceHour, 6);
  assert.equal(config.timezone, "Asia/Tokyo");
  assert.equal(notices.length, 2);
});

test("summary を書いても読まない", () => {
  const { config } = normalizeConfig({ weather: { areaCode: "130000" }, summary: { enabled: true } }, "/b");
  assert.equal("summary" in config, false);
});
