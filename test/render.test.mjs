import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../src/render.mjs";
import { extractForecast } from "../src/weather/extract.mjs";
import { jma1100 } from "./fixtures/jma.mjs";
import { htmlText, JST, paragraphs } from "./helpers.mjs";

const NOW = JST("2026-11-11T11:12:00");

// 正の文（天気仕様の3回目の文と、仕様1・2の残りの文）。設計書「出典と注記」。
const SOURCE = (code) => `出典：気象庁ホームページ（https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=${code}）、公共データ利用規約（第1.0版）（https://www.digital.go.jp/resources/open_data/public_data_license_v1.0）`;
const PROCESSED = "気象庁ホームページの天気予報をもとに morning-brief-jp が作成（文言と数値は変更していません）";

function freshWeather(overrides = {}) {
  const ex = extractForecast(jma1100(), { areaName: "東京地方", tempPointName: "東京", today: "2026-11-11" });
  return { state: "fresh", areaCode: "130000", failedAt: null, failReason: null, fetchedAt: JST("2026-11-11T11:12:00"), ...ex, ...overrides };
}

const view = (o = {}) => ({ version: "0.1.0", createdAt: NOW, timezone: "Asia/Tokyo", weather: freshWeather(), schedule: null, news: null, visibleItemsPerFeed: 4, ...o });

test("天気の欄の見出しと、注記・出典・加工の表示が一字一句同じで、別の段落", () => {
  const html = render(view());
  assert.match(html, /<h2 id="h-weather">天気<\/h2>/);
  const ps = paragraphs(html);
  for (const s of [SOURCE("130000"), PROCESSED]) assert.ok(ps.includes(s), `段落が無い：${s}`);
  // 出典と加工の表示は別の段落
  assert.notEqual(ps.indexOf(SOURCE("130000")), ps.indexOf(PROCESSED));
});

test("仕様1の古い1文目は出さない", () => {
  const text = htmlText(render(view()));
  assert.equal(text.includes("項目の抜き出しと並べ方は"), false);
  assert.equal(text.includes("発表）を、文言と数値を変えずに"), false);
});

test("禁止の語、アイコン、画像、警報の語、スクリプト、外部の読み込みが無い", () => {
  const html = render(view());
  for (const w of ["今日の予報", "本ツールの予報", "予想", "AI", "おすすめ", "警報", "注意報", "傘", "雨の心配"]) assert.equal(html.includes(w), false, w);
  assert.doesNotMatch(html, /<img|<svg|<script|<iframe|<link\b|\ssrc=/i);
});

test("出典のリンクは設定の地域コード。文字も表示する", () => {
  const html = render(view({ weather: freshWeather({ areaCode: "270000" }) }));
  assert.match(html, /href="https:\/\/www\.jma\.go\.jp\/bosai\/forecast\/#area_type=offices&amp;area_code=270000"/);
  assert.ok(paragraphs(html).includes(SOURCE("270000")));
});

test("発表時刻と取得時刻が別に出る。前日の取得は月日つき", () => {
  const html = render(view({ weather: freshWeather({ state: "stale", fetchedAt: JST("2026-11-10T18:20:00") }) }));
  const ps = paragraphs(html);
  assert.match(html, /<div class="alert stale-note"><p>前回取得分：/);
});

test("「前回取得分」は stale のときだけ。見出しの横の印は出さない（帯だけ）", () => {
  assert.equal(render(view()).includes("前回取得分"), false);
  const stale = render(view({ weather: freshWeather({ state: "stale", fetchedAt: JST("2026-11-10T18:20:00") }) }));
  assert.match(stale, /<div class="sec-head"><h2 id="h-weather">天気<\/h2>(<span class="area">[^<]*<\/span>)?<\/div>/);
  assert.equal(stale.split("前回取得分").length - 1, 1, "「前回取得分」は帯の1回だけ");
});

test("出典は1つずつ別の行（src-line）。段落の文字は変えない", () => {
  const html = render(view());
  assert.match(html, /<p class="source">出典：<span class="src-line">気象庁ホームページ（<a [^>]+>[^<]+<\/a>）、<\/span><span class="src-line">公共データ利用規約（第1\.0版）（<a [^>]+>[^<]+<\/a>）<\/span><\/p>/);
  assert.ok(paragraphs(html).includes(SOURCE("130000")));
});

test("日ごとの表示：見出し、天気の文、降水確率の時間帯、気温", () => {
  const text = htmlText(render(view()));
  assert.match(text, /今日 11月11日（水）/);
  assert.match(text, /明日 11月12日（木）/);
  assert.match(text, /見本の天気　のち　見本/);
  assert.match(text, /12–18時\n+0%/);
  assert.match(text, /18–24時\n+10%/);
  assert.match(text, /18–24時\n+50%/, "最後の時間帯：前がすべて6時間おきなので 18–24時");
  assert.equal(text.includes("18時〜"), false);
  assert.equal(text.includes("気温（東京）"), false);
  assert.match(text, /最低\n+—（発表なし）\n+最高\n+16℃/);
  assert.match(text, /最低\n+8℃\n+最高\n+17℃/);
});

test("取得失敗：失敗の文の下に別の行で回復の案内。官署・発表・取得の文は出さない", () => {
  const w = { state: "failed", failReason: "error", areaCode: "130000", failedAt: JST("2026-11-11T06:12:00"), fetchedAt: null, office: null, reportDatetime: null, areaName: null, tempPointName: null, days: [] };
  const html = render(view({ weather: w }));
  const ps = paragraphs(html);
  const i = ps.indexOf("気象庁のデータを取得できませんでした（06:12）");
  assert.ok(i >= 0);
  assert.equal(ps[i + 1], "設定の地域コードと通信を確かめて、時間をおいてもう一度実行してください。");
  assert.equal(ps.some((p) => p.startsWith("発表：") || p.startsWith("取得：")), false);
  for (const s of [SOURCE("130000"), PROCESSED]) assert.ok(ps.includes(s));
  assert.match(html, /<h2 id="h-weather">天気<\/h2>/);
});

test("上限でキャッシュなし：上限の文だけ（回復の案内と「前回取得分を使います」は出さない）", () => {
  const w = { state: "failed", failReason: "limit", areaCode: "130000", failedAt: NOW, fetchedAt: null, office: null, reportDatetime: null, areaName: null, tempPointName: null, days: [] };
  const html = render(view({ weather: w }));
  const ps = paragraphs(html);
  assert.ok(ps.includes("本日の気象庁への取得回数の上限に達しました。天気の欄は取得できませんでした。"));
  assert.equal(html.includes("時間をおいてもう一度"), false);
  assert.equal(html.includes("前回取得分を使います"), false);
});

// 失敗画面の「原因：」の1行（既存の2行は変えず、その下に足す）
const failedWith = (failCause, failReason = "error") => ({ state: "failed", failReason, failCause, areaCode: "130000", failedAt: JST("2026-11-11T06:12:00"), fetchedAt: null, office: null, reportDatetime: null, areaName: null, tempPointName: null, days: [] });
const FAILED_LINES = ["気象庁のデータを取得できませんでした（06:12）", "設定の地域コードと通信を確かめて、時間をおいてもう一度実行してください。"];

for (const [name, cause, line] of [
  ["地域コードが気象庁にない（404）", { kind: "area-unknown", code: "999999" }, "原因：地域コード 999999 が気象庁のデータにありません。"],
  ["接続できない", { kind: "network" }, "原因：気象庁のサーバーに接続できませんでした。"],
  ["想定外の応答（HTTP 503）", { kind: "unexpected", status: 503 }, "原因：気象庁から想定外の応答がありました（HTTP 503）。"],
  ["想定外の応答（番号なし：JSON が読めない）", { kind: "unexpected", status: null }, "原因：気象庁から想定外の応答がありました。"],
]) {
  test(`取得失敗の原因：${name}。既存の2行の下に1行`, () => {
    const ps = paragraphs(render(view({ weather: failedWith(cause) })));
    const i = ps.indexOf(FAILED_LINES[0]);
    assert.ok(i >= 0);
    assert.deepEqual(ps.slice(i, i + 3), [...FAILED_LINES, line]);
    assert.equal(ps.filter((p) => p.startsWith("原因：")).length, 1);
  });
}

test("取得失敗の原因：上限のときと、原因が分からないときは付けない", () => {
  const limit = render(view({ weather: failedWith({ kind: "network" }, "limit") }));
  assert.equal(htmlText(limit).includes("原因："), false);
  const unknown = paragraphs(render(view({ weather: failedWith(null) })));
  assert.equal(unknown.some((p) => p.startsWith("原因：")), false);
  assert.ok(unknown.includes(FAILED_LINES[1]));
});

test("前回取得分：見出しのすぐ下、地方名の上に発表時刻つきの1行（「昨日」は使わない）。注記の発表・取得はそのまま", () => {
  // 11-11 11:00 発表・11:12 取得のキャッシュを、翌朝 11-12 06:12 に前回取得分として出す
  const ex = extractForecast(jma1100(), { areaName: "東京地方", tempPointName: "東京", today: "2026-11-12" });
  const w = { state: "stale", areaCode: "130000", failedAt: null, failReason: null, fetchedAt: JST("2026-11-11T11:12:00"), ...ex };
  const html = render(view({ weather: w, createdAt: JST("2026-11-12T06:12:00") }));
  const line = "前回取得分：2026-11-11 11:00 発表の予報です。今日の発表ではありません。";
  assert.match(html, /<\/div>\n<div class="alert stale-note"><p>前回取得分：2026-11-11 11:00 発表の予報です。今日の発表ではありません。<\/p><\/div>\n<div class="days">/);
  const ps = paragraphs(html);
  assert.ok(ps.includes(line));
  assert.equal(htmlText(html).includes("昨日"), false);
  assert.doesNotMatch(html, /class="mark"/, "見出しの横の印は出さない（帯だけ）");
  // 新しい取得では出さない
  assert.equal(render(view()).includes('class="alert stale-note"'), false);
});

test("前回取得分：発表が今日（今日の 05:00 発表を昼に出す）なら「今日の発表ではありません。」は付けない", () => {
  const ex = extractForecast(jma1100(), { areaName: "東京地方", tempPointName: "東京", today: "2026-11-11" });
  const w = { state: "stale", areaCode: "130000", failedAt: null, failReason: null, fetchedAt: JST("2026-11-11T11:12:00"), ...ex };
  const ps = paragraphs(render(view({ weather: w, createdAt: JST("2026-11-11T19:00:00") })));
  assert.ok(ps.includes("前回取得分：2026-11-11 11:00 発表の予報です。"));
  assert.equal(ps.some((p) => p.includes("今日の発表ではありません")), false);
});

test("明日の項目（天気、降水確率、最低、最高）がすべて空：日の見出しの下に「含まれていません」の1行。個別の「—（発表なし）」は残す", () => {
  const w = freshWeather();
  w.days[1] = { ...w.days[1], weather: null, pops: w.days[1].pops.map((p) => ({ ...p, value: null })), tempMin: null, tempMax: null };
  const html = render(view({ weather: w }));
  assert.match(html, /<h3>明日 11月12日（木）<\/h3>\n<p class="day-empty">この発表（2026-11-11 11:00）に、明日の項目は含まれていません。<\/p>/);
  const days = html.split('<article class="day">');
  assert.equal(days[1].includes("含まれていません"), false, "今日には出さない");
  assert.ok((days[2].match(/—（発表なし）/g) ?? []).length >= 4, "個別の発表なしは残る");
});

test("今日の項目がすべて空：「今日」で同じ形の1行", () => {
  const w = freshWeather();
  // 見本の 11:00 発表には今日の最低があり決まりで消えている（tempMinHidden）。ここでは発表自体に無い場合を作る
  w.days[0] = { ...w.days[0], weather: null, pops: w.days[0].pops.map((p) => ({ ...p, value: null })), tempMin: null, tempMinHidden: false, tempMax: null };
  const ps = paragraphs(render(view({ weather: w })));
  assert.ok(ps.includes("この発表（2026-11-11 11:00）に、今日の項目は含まれていません。"));
  assert.equal(ps.filter((p) => p.includes("含まれていません")).length, 1);
});

test("最低が決まりで消えただけ（消す前は値があった）なら「含まれていません」は出さない", () => {
  const w = freshWeather();
  w.days[0] = { ...w.days[0], weather: null, pops: w.days[0].pops.map((p) => ({ ...p, value: null })), tempMin: null, tempMinHidden: true, tempMax: null };
  const html = render(view({ weather: w }));
  assert.equal(html.includes("含まれていません"), false);
  assert.ok(html.split('<article class="day">')[1].includes("—（発表なし）"), "個別の発表なしは出る");
});

test("一部だけ空（最高だけある、降水確率が1つだけある）なら「含まれていません」は出さない", () => {
  const w = freshWeather();
  w.days[1] = { ...w.days[1], weather: null, pops: w.days[1].pops.map((p) => ({ ...p, value: null })), tempMin: null };
  w.days[0] = { ...w.days[0], weather: null, pops: [{ from: "18", to: "24", value: "10" }], tempMin: null, tempMax: null };
  assert.equal(render(view({ weather: w })).includes("含まれていません"), false);
});

test("CSS：注記は 12px（--fs-xs）、行間1.5、段落の間8px", () => {
  const html = render(view());
  assert.match(html, /--fs-xs: 0\.75rem;/);
});

test("天気だけ：予定とニュースの欄も「未設定」の文も無い", () => {
  const html = render(view());
  const text = htmlText(html);
  assert.equal(text.includes("今日の予定"), false);
  assert.equal(text.includes("ニュース"), false);
  assert.equal(text.includes("未設定"), false);
  assert.match(html, /class="page no-news"/);
});

test("ページの組み立て：lang、viewport、CSP、題名、見出しの順、フッター", () => {
  const html = render(view());
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.doesNotMatch(html, /user-scalable|maximum-scale/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/);
  assert.match(html, /<title>朝のまとめ 2026-11-11（水）<\/title>/);
  assert.match(html, /<a class="skip" href="#main">本文へ移動<\/a>/);
  const order = [...html.matchAll(/<h([1-4])/g)].map((m) => Number(m[1]));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] <= order[i - 1] + 1, "見出しを飛ばさない");
  assert.match(htmlText(html), /morning-brief-jp 0\.1\.0 で作成 2026-11-11 11:12/);
  assert.match(html, /<span translate="no">morning-brief-jp<\/span>/);
});

test("CSS に禁止のもの（transition: all、outline: none、100vh、line-clamp）が無い", () => {
  const html = render(view());
  assert.doesNotMatch(html, /transition:\s*all|outline:\s*none|100vh|line-clamp|text-overflow|user-scalable/);
});

test("官署名が無いとき：注記の官署は空のまま（官署名を作らない）。ほかの文は同じ", () => {
  const html = render(view({ weather: freshWeather({ office: null }) }));
  const ps = paragraphs(html);
  assert.equal(htmlText(html).includes("気象台"), false);
  for (const s of [SOURCE("130000"), PROCESSED]) assert.ok(ps.includes(s), s);
});

test("気温の欄が無い JSON：最低・最高とも「—（発表なし）」、見出しは「気温」だけ", () => {
  const body = jma1100();
  body[0].timeSeries = body[0].timeSeries.filter((ts) => !ts.areas.some((a) => Array.isArray(a.temps)));
  const ex = extractForecast(body, { areaName: "東京地方", tempPointName: "東京", today: "2026-11-11" });
  const html = render(view({ weather: freshWeather({ ...ex }) }));
  const ps = paragraphs(html);
  assert.equal(ps.filter((p) => p === "気温").length, 2);
  assert.equal((html.match(/<dt>最低<\/dt><dd>—（発表なし）<\/dd>/g) ?? []).length, 2);
  assert.equal((html.match(/<dt>最高<\/dt><dd>—（発表なし）<\/dd>/g) ?? []).length, 2);
});

test("降水確率の時刻に分が付く：「12:30–18:00」「21:15〜」の形（時と混ぜない）", () => {
  const w = freshWeather();
  w.days[0].pops = [
    { from: "12:30", to: "18", value: "10" },
    { from: "18", to: "21:15", value: "20" },
    { from: "21:15", to: null, value: "30" },
  ];
  const html = render(view({ weather: w }));
  for (const l of ["12:30–18:00", "18:00–21:15", "21:15〜"]) assert.match(html, new RegExp(`<dt>${l}</dt>`), l);
});

test("CSS：ニュースの見出しリンクは高さ44px（--tap-min）以上", () => {
  const html = render(view());
  assert.match(html, /--tap-min: 2\.75rem;/);
  assert.match(html, /\.items a \{[^}]*min-height: var\(--tap-min\)/);
});
