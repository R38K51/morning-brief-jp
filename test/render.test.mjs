import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../src/render.mjs";
import { extractForecast } from "../src/weather/extract.mjs";
import { jma1100 } from "./fixtures/jma.mjs";
import { htmlText, JST, paragraphs } from "./helpers.mjs";

const NOW = JST("2026-11-11T11:12:00");

// 正の文（天気仕様の3回目の文と、仕様1・2の残りの文）。設計書「出典と注記」。
const NOTE1 = "発表：気象庁（2026-11-11 11:00）。気象庁の天気予報を、文言と数値を変えずに表示しています。項目の抜き出し、並べ方、日付と時間帯の書き方は morning-brief-jp が行っています。";
const NOTE2 = (t) => `取得：${t}。最新の情報は気象庁ホームページで確かめてください。表示の遅れや誤りについて、作者は責任を負いません。`;
const NOTE3 = "このツールは気象庁とは関係のない個人の作品です。";
const SOURCE = (code) => `出典：気象庁ホームページ（https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=${code}）、公共データ利用規約（第1.0版）（https://www.digital.go.jp/resources/open_data/public_data_license_v1.0）`;
const PROCESSED = "気象庁ホームページの天気予報をもとに morning-brief-jp が作成（文言と数値は変更していません）";

function freshWeather(overrides = {}) {
  const ex = extractForecast(jma1100(), { areaName: "東京地方", tempPointName: "東京", today: "2026-11-11" });
  return { state: "fresh", areaCode: "130000", failedAt: null, failReason: null, fetchedAt: JST("2026-11-11T11:12:00"), ...ex, ...overrides };
}

const view = (o = {}) => ({ version: "0.1.0", createdAt: NOW, timezone: "Asia/Tokyo", weather: freshWeather(), schedule: null, news: null, visibleItemsPerFeed: 4, ...o });

test("天気の欄の見出しと、注記・出典・加工の表示が一字一句同じで、別の段落", () => {
  const html = render(view());
  assert.match(html, /<h2 id="h-weather">天気（気象庁の発表）<\/h2>/);
  const ps = paragraphs(html);
  for (const s of [NOTE1, NOTE2("11:12"), NOTE3, SOURCE("130000"), PROCESSED]) assert.ok(ps.includes(s), `段落が無い：${s}`);
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
  assert.ok(ps.includes(NOTE1));
  assert.ok(ps.includes(NOTE2("11-10 18:20")));
  assert.match(html, /<p class="mark">前回取得分<\/p>/);
});

test("印「前回取得分」は stale のときだけ", () => {
  assert.equal(render(view()).includes("前回取得分"), false);
});

test("日ごとの表示：見出し、天気の文、降水確率の時間帯、気温", () => {
  const text = htmlText(render(view()));
  assert.match(text, /今日 11月11日（水）/);
  assert.match(text, /明日 11月12日（木）/);
  assert.match(text, /見本の天気　のち　見本/);
  assert.match(text, /12–18時\n+0%/);
  assert.match(text, /18–24時\n+10%/);
  assert.match(text, /18時〜\n+50%/);
  assert.match(text, /気温（東京）/);
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
  for (const s of [NOTE3, SOURCE("130000"), PROCESSED]) assert.ok(ps.includes(s));
  assert.match(html, /<h2 id="h-weather">天気（気象庁の発表）<\/h2>/);
});

test("上限でキャッシュなし：上限の文だけ（回復の案内と「前回取得分を使います」は出さない）", () => {
  const w = { state: "failed", failReason: "limit", areaCode: "130000", failedAt: NOW, fetchedAt: null, office: null, reportDatetime: null, areaName: null, tempPointName: null, days: [] };
  const html = render(view({ weather: w }));
  const ps = paragraphs(html);
  assert.ok(ps.includes("本日の気象庁への取得回数の上限に達しました。天気の欄は取得できませんでした。"));
  assert.equal(html.includes("時間をおいてもう一度"), false);
  assert.equal(html.includes("前回取得分を使います"), false);
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
