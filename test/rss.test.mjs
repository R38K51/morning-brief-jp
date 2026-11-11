import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseFeed, plainText, selectItems, truncate } from "../src/rss.mjs";
import { sinceThreshold } from "../src/time.mjs";
import { JST } from "./helpers.mjs";

const read = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const NOW = JST("2026-11-11T11:12:00");
const since = sinceThreshold(NOW, "Asia/Tokyo", 6);

test("前日6時の境目（設定の timezone）", () => {
  assert.equal(since.toISOString(), JST("2026-11-10T06:00:00").toISOString());
});

test("RSS 2.0：題名、リンク、時刻、説明（100字と…）。前日6時より前と時刻の無い記事は出ない", async () => {
  const items = selectItems(parseFeed(await read("rss2.xml")), since, 10);
  assert.deepEqual(items.map((i) => i.title), ["12345", '[例] 見本の見出し <script>alert(1)</script> & "引用"', "危ないリンクの見出し"]);
  const first = items[1];
  assert.equal(first.link, "https://example.com/articles/1");
  assert.equal(first.publishedAt.toISOString(), JST("2026-11-11T06:40:00").toISOString());
  assert.ok(first.description.startsWith("見本の説明です。 太字 &記号。"));
  assert.ok(first.description.endsWith("…"));
  assert.equal(Array.from(first.description).length, 101);
});

test("見出しは加工しない（[媒体名] も数字だけの見出しもそのまま）", async () => {
  const items = parseFeed(await read("rss2.xml"));
  assert.equal(items[0].title.startsWith("[例] "), true);
  assert.equal(items[4].title, "12345");
  assert.equal(typeof items[4].title, "string");
});

test("本文（content）は取らない", async () => {
  const items = parseFeed(await read("rss2.xml"));
  assert.equal(JSON.stringify(items).includes("本文は取らない"), false);
  const atom = parseFeed(await read("atom.xml"));
  assert.equal(JSON.stringify(atom).includes("本文は取らない"), false);
});

test("javascript: のリンクはリンクにしない", async () => {
  const items = parseFeed(await read("rss2.xml"));
  assert.equal(items[2].link, null);
});

test("RSS 1.0（dc:date）", async () => {
  const items = selectItems(parseFeed(await read("rss1.xml")), since, 10);
  assert.deepEqual(items.map((i) => [i.title, i.link]), [["RSS 1.0 の見本の見出し", "https://example.com/rdf/1"]]);
  assert.equal(items[0].description, "RSS 1.0 の見本の説明");
});

test("Atom：rel=alternate のリンク、published、summary", async () => {
  const items = selectItems(parseFeed(await read("atom.xml")), since, 10);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Atom の見本の見出し");
  assert.equal(items[0].link, "https://example.com/atom/1");
  assert.equal(items[0].publishedAt.toISOString(), "2026-11-10T21:30:00.000Z");
  assert.equal(items[0].description, "Atom の見本の説明");
  assert.equal(items[1].link, "https://example.com/atom/2");
});

test("新しい順に並べ、上限で切る", async () => {
  const items = selectItems(parseFeed(await read("rss2.xml")), since, 2);
  assert.equal(items.length, 2);
  assert.ok(items[0].publishedAt > items[1].publishedAt);
});

test("壊れた XML とフィードでない XML は例外", () => {
  assert.throws(() => parseFeed("<rss><channel><item><title>x</item></channel>"));
  assert.throws(() => parseFeed("<html><body>x</body></html>"));
});

test("説明の整え方：タグを除き、文字参照を戻し、空白をまとめる", () => {
  assert.equal(plainText("<p>a&nbsp;&amp;&#12354;</p>\n\n b"), "a &あ b");
  assert.equal(truncate("あ".repeat(100)), "あ".repeat(100));
  assert.equal(truncate("👨‍👩‍👧".repeat(101)), "👨‍👩‍👧".repeat(100) + "…");
});
