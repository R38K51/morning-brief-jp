import { test } from "node:test";
import assert from "node:assert/strict";
import { canUseStale, isReportOld, planWeather, requestsToday, validateCache } from "../src/weather/policy.mjs";
import { JST } from "./helpers.mjs";

const cacheRaw = (o = {}) => ({ areaCode: "130000", fetchedAt: JST("2026-11-11T06:10:00").toISOString(), reportDatetime: "2026-11-11T05:00:00+09:00", body: [{}], ...o });

test("3時間以内（取得時刻から）ならキャッシュを使う", () => {
  const now = JST("2026-11-11T09:10:00");
  const cache = validateCache(cacheRaw(), "130000", now);
  assert.equal(planWeather({ cache, requestCount: 0, now }).kind, "use-cache");
  const later = JST("2026-11-11T09:11:00");
  assert.equal(planWeather({ cache: validateCache(cacheRaw(), "130000", later), requestCount: 0, now: later }).kind, "fetch");
});

test("今日4回取ったら5回目は取りに行かない", () => {
  const now = JST("2026-11-11T20:00:00");
  assert.deepEqual(planWeather({ cache: null, requestCount: 3, now }), { kind: "fetch", budget: 1 });
  assert.equal(planWeather({ cache: null, requestCount: 4, now }).kind, "limit");
});

test("日付（設定の timezone）が変わると数え直す", () => {
  const reqs = ["2026-11-11T06:00:00+09:00", "2026-11-11T12:00:00+09:00", "2026-11-11T23:59:00+09:00"].map((s) => new Date(s).toISOString());
  assert.equal(requestsToday(reqs, JST("2026-11-11T23:59:30"), "Asia/Tokyo").length, 3);
  assert.equal(requestsToday(reqs, JST("2026-11-12T00:00:30"), "Asia/Tokyo").length, 0);
  // UTC で数えると日付が違う（設定の timezone で数えていることの確認）
  assert.equal(requestsToday(reqs, JST("2026-11-12T00:00:30"), "UTC").length, 2);
});

test("24時間は発表時刻から数える：取得は新しくても発表から24時間超なら出さない", () => {
  const now = JST("2026-11-12T06:00:00");
  const cache = validateCache(cacheRaw({ fetchedAt: JST("2026-11-12T01:00:00").toISOString(), reportDatetime: "2026-11-11T05:00:00+09:00" }), "130000", now);
  assert.ok(cache);
  assert.equal(canUseStale(cache, now), false);
  const cache2 = validateCache(cacheRaw({ reportDatetime: "2026-11-11T11:00:00+09:00" }), "130000", now);
  assert.equal(canUseStale(cache2, now), true);
});

test("reportDatetime が読めない・未来のキャッシュは無いものとして扱う", () => {
  const now = JST("2026-11-11T10:00:00");
  assert.equal(validateCache(cacheRaw({ reportDatetime: undefined }), "130000", now), null);
  assert.equal(validateCache(cacheRaw({ reportDatetime: "きのう" }), "130000", now), null);
  assert.equal(validateCache(cacheRaw({ reportDatetime: "2026-11-11T11:00:00+09:00" }), "130000", now), null);
});

test("地域コードが違うキャッシュは使わない", () => {
  assert.equal(validateCache(cacheRaw(), "270000", JST("2026-11-11T07:00:00")), null);
});

test("壊れたキャッシュは無いものとして扱う", () => {
  assert.equal(validateCache(null, "130000", new Date()), null);
  assert.equal(validateCache({ areaCode: "130000", body: "x" }, "130000", new Date()), null);
});

test("発表が24時間より古いかの判定", () => {
  assert.equal(isReportOld("2026-11-10T05:00:00+09:00", JST("2026-11-11T05:00:01")), true);
  assert.equal(isReportOld("2026-11-10T05:00:00+09:00", JST("2026-11-11T05:00:00")), false);
});
