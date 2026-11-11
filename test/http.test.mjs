import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBytes, fetchText, FetchError, TIMEOUT_MS, USER_AGENT } from "../src/http.mjs";
import { fakeFetch, recordingSleep } from "./helpers.mjs";

const U = "https://example.com/x";

test("User-Agent は作品名と版と公開先。メールの形の文字を含まない", async () => {
  assert.equal(USER_AGENT, "morning-brief-jp/0.1.0 (+https://github.com/R38K51/morning-brief-jp)");
  assert.doesNotMatch(USER_AGENT, /@/);
  const f = fakeFetch({ [U]: { body: "ok" } });
  await fetchText(U, { fetchImpl: f, sleep: recordingSleep() });
  assert.equal(f.calls[0].init.headers["User-Agent"], USER_AGENT);
});

test("タイムアウトは10秒で、取得ごとに signal を付ける", async () => {
  assert.equal(TIMEOUT_MS, 10_000);
  const f = fakeFetch({ [U]: { body: "ok" } });
  await fetchText(U, { fetchImpl: f });
  assert.ok(f.calls[0].init.signal instanceof AbortSignal);
});

test("5xx は1回だけ再試行し、待ちは指定どおり", async () => {
  const f = fakeFetch({ [U]: { status: 503, body: "" } });
  const sleep = recordingSleep();
  await assert.rejects(fetchText(U, { fetchImpl: f, sleep, retryDelayMs: 60_000 }), (e) => e instanceof FetchError && e.status === 503);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(sleep.waits, [60_000]);
});

test("404 は再試行しない", async () => {
  const f = fakeFetch({ [U]: { status: 404, body: "" } });
  const sleep = recordingSleep();
  await assert.rejects(fetchText(U, { fetchImpl: f, sleep, retryDelayMs: 60_000 }), (e) => e.status === 404);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(sleep.waits, []);
});

test("通信の失敗のあと成功すれば値を返す。onAttempt は送るたびに呼ばれる", async () => {
  const f = fakeFetch({ [U]: [new TypeError("fetch failed"), { body: "ok" }] });
  let n = 0;
  const r = await fetchText(U, { fetchImpl: f, sleep: recordingSleep(), onAttempt: () => n++ });
  assert.equal(r.text, "ok");
  assert.equal(n, 2);
});

test("エラーの文に URL を含めない", async () => {
  const secret = "https://calendar.example.invalid/private-SECRET-TOKEN/basic.ics";
  const f = async () => {
    throw new TypeError(`fetch failed for ${secret}`);
  };
  await assert.rejects(fetchText(secret, { fetchImpl: f, sleep: recordingSleep() }), (e) => !String(e.message).includes("SECRET") && !String(e.stack).includes("SECRET"));
});

test("5MB を超える応答は打ち切る", async () => {
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  const f = fakeFetch({ [U]: { body: big } });
  await assert.rejects(fetchText(U, { fetchImpl: f, sleep: recordingSleep(), retries: 0 }), (e) => e.kind === "too-large");
});

test("文字コード：Content-Type → XML 宣言 → UTF-8", () => {
  const sjis = new Uint8Array([0x82, 0xa0]); // 「あ」の Shift_JIS
  assert.equal(decodeBytes(sjis, "text/xml; charset=Shift_JIS"), "あ");
  const decl = new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?><a>い</a>');
  assert.match(decodeBytes(decl, ""), /い/);
});
