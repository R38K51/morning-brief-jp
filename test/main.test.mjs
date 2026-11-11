import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { run } from "../src/main.mjs";
import { FORECAST_URL } from "../src/weather/index.mjs";
import { jma0500, jma1100 } from "./fixtures/jma.mjs";
import { fakeFetch, htmlText, JST, paragraphs, recordingSleep, tempDir, writeConfig } from "./helpers.mjs";

const NOW = JST("2026-11-11T11:12:00");
const SECRET_URL = "https://calendar.example.invalid/private-SECRET-TOKEN-1234/basic.ics";
const FEED_A = "https://example.com/feed-a.xml";
const FEED_B = "https://example.com/feed-b.xml";
const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

async function prepare(t, config) {
  const d = await tempDir();
  t.after(d.cleanup);
  await mkdir(path.join(d.dir, ".cache"), { recursive: true });
  await writeFile(path.join(d.dir, ".cache", "area.json"), JSON.stringify({ lastAreaCode: "130000", offices: ["130000"] }));
  const file = await writeConfig(d.dir, { weather: { areaCode: "130000", areaName: "東京地方", tempPointName: "東京" }, ...config });
  return { dir: d.dir, file };
}

async function go(file, routes, env = {}) {
  const logs = [];
  const f = fakeFetch(routes);
  const r = await run({ configPath: file, now: NOW, fetchImpl: f, sleep: recordingSleep(), env, log: (m) => logs.push(m) });
  const html = r.outputPath ? await readFile(r.outputPath, "utf8") : null;
  return { ...r, logs, html, calls: f.calls };
}

const fullConfig = {
  schedule: { enabled: true },
  feeds: [
    { name: "例のフィード A", url: FEED_A },
    { name: "例のフィード B", url: FEED_B },
  ],
};

test("地域コードだけの設定：天気の欄だけの HTML（予定とニュースの欄も「未設定」の文も無い）", async (t) => {
  const { file, dir } = await prepare(t, {});
  const r = await go(file, { [FORECAST_URL("130000")]: { body: jma1100() } });
  assert.equal(r.exitCode, 0);
  assert.equal(r.outputPath, path.join(dir, "out", "morning-brief.html"));
  const text = htmlText(r.html);
  assert.match(text, /天気/);
  for (const s of ["今日の予定", "ニュース", "未設定"]) assert.equal(text.includes(s), false, s);
  assert.deepEqual(r.logs, ["気象庁から取得しています…", `朝のまとめを作りました：${r.outputPath}`, "欄：天気"]);
});

test("3つの欄すべて：欄の順は天気 → 予定 → ニュース", async (t) => {
  const { file } = await prepare(t, fullConfig);
  const r = await go(
    file,
    { [FORECAST_URL("130000")]: { body: jma1100() }, [SECRET_URL]: { body: await fixture("calendar.ics") }, [FEED_A]: { body: await fixture("rss2.xml") }, [FEED_B]: { body: await fixture("atom.xml") } },
    { MORNING_BRIEF_ICAL_URL: SECRET_URL },
  );
  const text = htmlText(r.html);
  const a = text.indexOf("天気");
  const b = text.indexOf("今日の予定");
  const c = text.indexOf("ニュース\n");
  assert.ok(a >= 0 && a < b && b < c);
  assert.equal(r.html.includes("利用条件は各サイトで"), false);
  assert.match(text, /会議の例/);
  assert.match(text, /Atom の見本の見出し/);
  assert.ok(r.logs.includes("ニュースを取得しています…（2件のフィード）"));
  assert.ok(r.logs.includes("欄：天気 / 予定 / ニュース（2件のフィード）"));
});

test("天気だけ失敗：天気の欄が失敗の文、ほかの欄は出る", async (t) => {
  const { file } = await prepare(t, fullConfig);
  const r = await go(
    file,
    { [FORECAST_URL("130000")]: new TypeError("fetch failed"), [SECRET_URL]: { body: await fixture("calendar.ics") }, [FEED_A]: { body: await fixture("rss2.xml") }, [FEED_B]: { body: await fixture("atom.xml") } },
    { MORNING_BRIEF_ICAL_URL: SECRET_URL },
  );
  assert.equal(r.exitCode, 0);
  const ps = paragraphs(r.html);
  assert.ok(ps.includes("気象庁のデータを取得できませんでした（11:12）"));
  assert.ok(ps.includes("設定の地域コードと通信を確かめて、時間をおいてもう一度実行してください。"));
  assert.match(htmlText(r.html), /会議の例/);
  assert.ok(r.logs.includes("気象庁のデータを取得できませんでした。設定の地域コードと通信を確かめて、時間をおいてもう一度実行してください。"));
});

test("予定だけ失敗：決まった文言。ほかの欄は出る", async (t) => {
  const { file } = await prepare(t, fullConfig);
  const r = await go(
    file,
    { [FORECAST_URL("130000")]: { body: jma1100() }, [SECRET_URL]: { status: 403, body: "" }, [FEED_A]: { body: await fixture("rss2.xml") }, [FEED_B]: { body: await fixture("atom.xml") } },
    { MORNING_BRIEF_ICAL_URL: SECRET_URL },
  );
  const ps = paragraphs(r.html);
  assert.ok(ps.includes("予定を読み込めませんでした。iCal の URL の設定を確かめてください。"));
  assert.match(htmlText(r.html), /見本の天気/);
});

test("1つのフィードだけ失敗：そのフィードの下だけ失敗の文", async (t) => {
  const { file } = await prepare(t, { feeds: fullConfig.feeds });
  const r = await go(file, { [FORECAST_URL("130000")]: { body: jma1100() }, [FEED_A]: { body: "<rss><channel><item>" }, [FEED_B]: { body: await fixture("atom.xml") } });
  const html = r.html;
  const secA = html.slice(html.indexOf("例のフィード A"), html.indexOf("例のフィード B"));
  assert.match(secA, /取得できませんでした。フィードの URL を確かめてください。/);
  const secB = html.slice(html.indexOf("例のフィード B"));
  assert.doesNotMatch(secB, /取得できませんでした/);
  assert.match(secB, /Atom の見本の見出し/);
});

test("全部失敗：HTML はでき、各欄にそれぞれの文", async (t) => {
  const { file } = await prepare(t, fullConfig);
  const r = await go(file, {}, { MORNING_BRIEF_ICAL_URL: SECRET_URL });
  assert.equal(r.exitCode, 0);
  const ps = paragraphs(r.html);
  assert.ok(ps.includes("気象庁のデータを取得できませんでした（11:12）"));
  assert.ok(ps.includes("予定を読み込めませんでした。iCal の URL の設定を確かめてください。"));
  assert.equal(ps.filter((p) => p === "取得できませんでした。フィードの URL を確かめてください。").length, 2);
});

test("フィードの空：前日6時以降の記事が無い文。予定が0件：予定はありませんの文", async (t) => {
  const { file } = await prepare(t, { schedule: { enabled: true }, feeds: [{ name: "例のフィード A", url: FEED_A }] });
  const emptyFeed = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';
  const emptyCal = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//example//t//JA\nEND:VCALENDAR\n";
  const r = await go(file, { [FORECAST_URL("130000")]: { body: jma1100() }, [FEED_A]: { body: emptyFeed }, [SECRET_URL]: { body: emptyCal } }, { MORNING_BRIEF_ICAL_URL: SECRET_URL });
  const ps = paragraphs(r.html);
  assert.ok(ps.includes("前日6時以降の新しい記事はありません。"));
  assert.ok(ps.includes("今日の予定はありません。"));
});

test("TZID を解決できない予定：飛ばして「一部の予定を読めませんでした。」", async (t) => {
  const { file } = await prepare(t, { schedule: { enabled: true } });
  const r = await go(file, { [FORECAST_URL("130000")]: { body: jma1100() }, [SECRET_URL]: { body: await fixture("calendar-unknown-tz.ics") } }, { MORNING_BRIEF_ICAL_URL: SECRET_URL });
  const ps = paragraphs(r.html);
  assert.ok(ps.includes("一部の予定を読めませんでした。"));
  assert.match(htmlText(r.html), /作業の例/);
  assert.equal(htmlText(r.html).includes("読めない地域の例"), false);
});

test("iCal の URL（架空の秘密の文字）は、成功でも失敗でも、コンソールにも HTML にも出ない", async (t) => {
  for (const cal of [await fixture("calendar.ics"), { status: 500, body: "" }, new TypeError(`fetch failed ${SECRET_URL}`), { body: "BEGIN:VCALENDAR\nbroken" }]) {
    const { file } = await prepare(t, { schedule: { enabled: true } });
    const route = typeof cal === "string" ? { body: cal } : cal;
    const r = await go(file, { [FORECAST_URL("130000")]: { body: jma1100() }, [SECRET_URL]: route }, { MORNING_BRIEF_ICAL_URL: SECRET_URL });
    assert.equal(r.html.includes("SECRET-TOKEN"), false);
    assert.equal(r.logs.join("\n").includes("SECRET-TOKEN"), false);
    assert.equal(r.html.includes("calendar.example.invalid"), false);
  }
});

test("予定とニュースはキャッシュしない（.cache に予定の題名が残らない）", async (t) => {
  const { file, dir } = await prepare(t, fullConfig);
  await go(
    file,
    { [FORECAST_URL("130000")]: { body: jma1100() }, [SECRET_URL]: { body: await fixture("calendar.ics") }, [FEED_A]: { body: await fixture("rss2.xml") }, [FEED_B]: { body: await fixture("atom.xml") } },
    { MORNING_BRIEF_ICAL_URL: SECRET_URL },
  );
  const files = await readdir(path.join(dir, ".cache"));
  for (const f of files) {
    const s = await readFile(path.join(dir, ".cache", f), "utf8");
    assert.equal(s.includes("会議の例"), false);
    assert.equal(s.includes("見本の見出し"), false);
  }
});

test("webcal: は https: に読み替える", async (t) => {
  const { file } = await prepare(t, { schedule: { enabled: true } });
  const r = await go(file, { [FORECAST_URL("130000")]: { body: jma1100() }, [SECRET_URL]: { body: await fixture("calendar.ics") } }, { MORNING_BRIEF_ICAL_URL: SECRET_URL.replace("https:", "webcal:") });
  assert.match(htmlText(r.html), /会議の例/);
});

test("予定が有効で環境変数が空：文言を出し、予定の欄は出さない", async (t) => {
  const { file } = await prepare(t, { schedule: { enabled: true } });
  const r = await go(file, { [FORECAST_URL("130000")]: { body: jma1100() } }, {});
  assert.ok(r.logs.includes("環境変数 MORNING_BRIEF_ICAL_URL が空です。予定の欄は出しません。"));
  assert.equal(htmlText(r.html).includes("今日の予定"), false);
});

test("フィードの URL が不正：文言を出し、そのフィードは失敗の表示。URL が空のフィードは何も言わず飛ばす", async (t) => {
  const { file } = await prepare(t, { feeds: [{ name: "空", url: "" }, { name: "不正", url: "ftp://example.com/x" }] });
  const r = await go(file, { [FORECAST_URL("130000")]: { body: jma1100() } });
  assert.ok(r.logs.includes("フィード「不正」の URL を確かめてください。"));
  assert.equal(r.logs.some((l) => l.includes("「空」")), false);
  assert.equal(r.calls.some((c) => c.url.startsWith("ftp:")), false);
  assert.equal(htmlText(r.html).includes("\n空\n"), false);
});

test("残りの記事は details に入る（既定4件を見せる）", async (t) => {
  const { file } = await prepare(t, { feeds: [{ name: "例のフィード A", url: FEED_A }] });
  const items = Array.from({ length: 9 }, (_, i) => `<item><title>見本 ${i + 1}</title><link>https://example.com/${i}</link><pubDate>Wed, 11 Nov 2026 0${i}:10:00 +0900</pubDate></item>`).join("");
  const r = await go(file, { [FORECAST_URL("130000")]: { body: jma1100() }, [FEED_A]: { body: `<rss version="2.0"><channel><title>x</title>${items}</channel></rss>` } });
  assert.match(r.html, /<details><summary>残り5件を見る<\/summary>/);
});

test("設定の誤り：HTML を書かず、決まった文言と終了コード 1", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const missing = await go(path.join(d.dir, "config.json"), {});
  assert.equal(missing.exitCode, 1);
  assert.deepEqual(missing.logs, ["config.json が見つかりません。config.example.json を config.json という名前でコピーしてください。"]);
  const file = await writeConfig(d.dir, '{ "weather": { "areaCode": "" } }');
  const empty = await go(file, {});
  assert.equal(empty.exitCode, 1);
  assert.match(empty.logs[0], /^weather\.areaCode が設定されていません。/);
  await writeConfig(d.dir, '{\n "weather": {\n  "areaCode": "130000",\n }\n}');
  const bad = await go(file, {});
  assert.equal(bad.exitCode, 1);
  assert.match(bad.logs[0], /^config\.json の \d+ 行目付近を確かめてください（JSON として読めません）。$/);
  await assert.rejects(readFile(path.join(d.dir, "out", "morning-brief.html")));
});

test("エスケープ：<script>、\"、& を含む見出しと予定の題名は文字として出る", async (t) => {
  const { file } = await prepare(t, { schedule: { enabled: true }, feeds: [{ name: "例 <b>&\"", url: FEED_A }] });
  const cal = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//example//t//JA\nBEGIN:VEVENT\nUID:x@example.invalid\nDTSTART:20261111T010000Z\nSUMMARY:<script>alert("x")</script> & 予定\nEND:VEVENT\nEND:VCALENDAR\n';
  const r = await go(file, { [FORECAST_URL("130000")]: { body: jma1100() }, [SECRET_URL]: { body: cal }, [FEED_A]: { body: await fixture("rss2.xml") } }, { MORNING_BRIEF_ICAL_URL: SECRET_URL });
  assert.doesNotMatch(r.html, /<script/i);
  assert.match(r.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; 予定/);
  assert.match(r.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;引用&quot;/);
  assert.match(r.html, /<h3 id="h-feed-0">例 &lt;b&gt;&amp;&quot;<\/h3>/);
  assert.match(r.html, /<span class="title">危ないリンクの見出し<\/span>/);
  assert.doesNotMatch(r.html, /href="javascript:/i);
  assert.doesNotMatch(r.html, /\ssrc=/i);
});

test("出力は一時ファイルから名前を変えて書く（一時ファイルが残らない）", async (t) => {
  const { file, dir } = await prepare(t, {});
  await go(file, { [FORECAST_URL("130000")]: { body: jma1100() } });
  const files = await readdir(path.join(dir, "out"));
  assert.deepEqual(files, ["morning-brief.html"]);
});

test("3時間超〜24時間以内のキャッシュがあっても、取得に成功したら印なし（HTML まで）。失敗なら印あり", async (t) => {
  const cacheBody = jma0500();
  const cache = { areaCode: "130000", fetchedAt: JST("2026-11-11T07:12:00").toISOString(), reportDatetime: cacheBody[0].reportDatetime, body: cacheBody };
  // 成功：新しい発表（11:00）を出し、印「前回取得分」は無い
  const ok = await prepare(t, {});
  await writeFile(path.join(ok.dir, ".cache", "weather-130000.json"), JSON.stringify(cache));
  const r = await go(ok.file, { [FORECAST_URL("130000")]: { body: jma1100() } });
  assert.equal(r.calls.length, 1, "4時間前のキャッシュなので取りに行く");
  assert.equal(r.view.weather.state, "fresh");
  assert.equal(r.html.includes("前回取得分"), false);
  assert.doesNotMatch(r.html, /class="mark"/);
  const ps = paragraphs(r.html);
  // 比べるため：同じキャッシュで取得に失敗したら印が出る
  const ng = await prepare(t, {});
  await writeFile(path.join(ng.dir, ".cache", "weather-130000.json"), JSON.stringify(cache));
  const r2 = await go(ng.file, { [FORECAST_URL("130000")]: new TypeError("fetch failed") });
  assert.match(r2.html, /<div class="alert stale-note"><p>前回取得分：2026-11-11 05:00 発表の予報です。/);
});

test("設定の誤り：形の違う地域コードと配列の設定は、原因に合う文言で終了コード 1", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const file = await writeConfig(d.dir, { weather: { areaCode: "abc" } });
  const bad = await go(file, {});
  assert.equal(bad.exitCode, 1);
  assert.deepEqual(bad.logs, ["weather.areaCode の形が違います（abc）。6桁の数字で書いてください（東京都の例：130000）。"]);
  assert.equal(bad.calls.length, 0);
  await writeConfig(d.dir, "[]");
  const arr = await go(file, {});
  assert.equal(arr.exitCode, 1);
  assert.deepEqual(arr.logs, ["config.json は { } で囲んだオブジェクトで書いてください（config.example.json の形）。"]);
  assert.equal(arr.calls.length, 0);
});
