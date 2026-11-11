// 表示用のデータ（view）→ 1枚の HTML。通信もファイルの読み書きもしない（CSS は起動時に1回読む）。
// 画面に出す文字はすべてエスケープする。JavaScript と外部の読み込みは入れない。

import { readFileSync } from "node:fs";
import { esc, safeHttpUrl } from "./escape.mjs";
import { dateLabelParts, formatHM, formatHMWithDate, jmaLocalParts, ymd } from "./time.mjs";

const CSS = readFileSync(new URL("./style.css", import.meta.url), "utf8");

export const TEXT = {
  pageTitle: "朝のまとめ",
  skip: "本文へ移動",
  weatherHeading: "天気",
  pop: "降水確率",
  min: "最低",
  max: "最高",
  none: "—（発表なし）",
  weatherFailed: (hm) => `気象庁のデータを取得できませんでした（${hm}）`,
  weatherRecover: "設定の地域コードと通信を確かめて、時間をおいてもう一度実行してください。",
  weatherLimit: "本日の気象庁への取得回数の上限に達しました。天気の欄は取得できませんでした。",
  causeAreaUnknown: (code) => `原因：地域コード ${code} が気象庁のデータにありません。`,
  causeNetwork: "原因：気象庁のサーバーに接続できませんでした。",
  causeUnexpected: (status) => (status ? `原因：気象庁から想定外の応答がありました（HTTP ${status}）。` : "原因：気象庁から想定外の応答がありました。"),
  // 発表が今日のとき（今日の 05:00 発表を昼に前回取得分で出すなど）は、事実と合わない2文目を付けない
  staleNote: (report, reportIsToday) => `前回取得分：${report} 発表の予報です。${reportIsToday ? "" : "今日の発表ではありません。"}`,
  dayNotIncluded: (report, label) => `この発表（${report}）に、${label}の項目は含まれていません。`,
  sourceJmaUrl: (code) => `https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=${code}`,
  sourcePdlUrl: "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0",
  noteProcessed: "気象庁ホームページの天気予報をもとに morning-brief-jp が作成（文言と数値は変更していません）",
  scheduleHeading: "今日の予定",
  allDay: "終日",
  noEvents: "今日の予定はありません。",
  scheduleFailed: "予定を読み込めませんでした。iCal の URL の設定を確かめてください。",
  schedulePartial: "一部の予定を読めませんでした。",
  untitled: "（題名なし）",
  newsHeading: "ニュース",
  feedEmpty: "前日6時以降の新しい記事はありません。",
  feedFailed: "取得できませんでした。フィードの URL を確かめてください。",
  more: (n) => `残り${n}件を見る`,
  footer: (version, created) => `morning-brief-jp ${version} で作成 ${created}`,
};

const BRAND = "morning-brief-jp";
/** すでにエスケープした文字の中の作品名に translate="no" を付ける。 */
const brand = (escaped) => escaped.split(BRAND).join(`<span translate="no">${BRAND}</span>`);

const link = (href, label) => `<a href="${esc(href)}" rel="noopener noreferrer">${esc(label)}</a>`;

function dayHeading(day) {
  const p = dateLabelParts(day.date);
  const d = `${p.month}月${p.day}日（${p.weekday}）`;
  return day.label ? `${day.label} ${d}` : d;
}

function popLabel(pop) {
  // 分が付く時刻があるときは「12:30–18:00」の形（「時」と混ぜない）
  if (pop.from.includes(":") || (pop.to ?? "").includes(":")) {
    const hm = (x) => (x.includes(":") ? x : `${x}:00`);
    return pop.to === null ? `${hm(pop.from)}〜` : `${hm(pop.from)}–${hm(pop.to)}`;
  }
  return pop.to === null ? `${pop.from}時〜` : `${pop.from}–${pop.to}時`;
}

const valueOrNone = (v, unit = "") => (v === null || v === undefined ? TEXT.none : `${v}${unit}`);

/** 天気、降水確率、最低、最高がすべて空か（日の見出しの下に「含まれていません」の1行を出す条件）。 */
const isEmpty = (v) => v === null || v === undefined;
function dayAllEmpty(day) {
  return isEmpty(day.weather) && day.pops.every((p) => isEmpty(p.value)) && isEmpty(day.tempMin) && isEmpty(day.tempMax);
}

function renderDay(day, report) {
  const notIncluded = day.label && dayAllEmpty(day) ? `<p class="day-empty">${esc(TEXT.dayNotIncluded(report, day.label))}</p>\n` : "";
  const pops = day.pops.length
    ? `<dl class="grid pops">${day.pops.map((p) => `<div><dt>${esc(popLabel(p))}</dt><dd>${esc(valueOrNone(p.value, "%"))}</dd></div>`).join("")}</dl>`
    : `<p>${esc(TEXT.none)}</p>`;
  const tempLabel = "気温";
  return `<article class="day">
<h3>${esc(dayHeading(day))}</h3>
${notIncluded}<p class="wx">${esc(day.weather ?? TEXT.none)}</p>
<p class="label label-pop">${esc(TEXT.pop)}</p>
${pops}
<p class="label label-temp">${esc(tempLabel)}</p>
<dl class="grid"><div><dt>${esc(TEXT.min)}</dt><dd>${esc(valueOrNone(day.tempMin, "℃"))}</dd></div><div><dt>${esc(TEXT.max)}</dt><dd>${esc(valueOrNone(day.tempMax, "℃"))}</dd></div></dl>
</article>`;
}

function causeText(cause) {
  if (!cause) return null;
  if (cause.kind === "area-unknown") return TEXT.causeAreaUnknown(cause.code);
  if (cause.kind === "network") return TEXT.causeNetwork;
  if (cause.kind === "unexpected") return TEXT.causeUnexpected(cause.status);
  return null;
}

function reportText(reportDatetime) {
  const p = jmaLocalParts(reportDatetime);
  return p ? `${p.date} ${p.hm}` : String(reportDatetime ?? "");
}

export function renderWeather(w, { now, timezone }) {
  // 前回取得分は見出しの下の帯（staleNote）だけで示す。見出し横の印は二重表示になるため出さない（2026-11-11 再確認2）
  const area = w.state !== "failed" && w.areaName ? `<span class="area">${esc(w.areaName)}</span>` : "";
  const head = `<div class="sec-head"><h2 id="h-weather">${esc(TEXT.weatherHeading)}</h2>${area}</div>`;
  let body;
  if (w.state === "failed") {
    const cause = w.failReason === "limit" ? null : causeText(w.failCause);
    body =
      w.failReason === "limit"
        ? `<div class="alert"><p>${esc(TEXT.weatherLimit)}</p></div>`
        : `<div class="alert"><p>${esc(TEXT.weatherFailed(formatHM(w.failedAt, timezone)))}</p><p>${esc(TEXT.weatherRecover)}</p>${cause ? `<p class="cause">${esc(cause)}</p>` : ""}</div>`;
  } else {
    const report = reportText(w.reportDatetime);
    const reportIsToday = jmaLocalParts(w.reportDatetime)?.date === ymd(now, timezone);
    const staleNote = w.state === "stale" ? `<div class="alert stale-note"><p>${esc(TEXT.staleNote(report, reportIsToday))}</p></div>\n` : "";
    body = `${staleNote}<div class="days">
${w.days.map((d) => renderDay(d, report)).join("\n")}
</div>`;
  }
  return `<section class="weather" aria-labelledby="h-weather">
${head}
${body}
</section>`;
}

/** 出典と加工の表示（気象庁の利用条件で必要）。画面の下、フッターに小さく出す。 */
export function renderCredits(w) {
  return `<div class="credits">
<p class="source">出典：<span class="src-line">気象庁ホームページ（${link(TEXT.sourceJmaUrl(w.areaCode), TEXT.sourceJmaUrl(w.areaCode))}）、</span><span class="src-line">公共データ利用規約（第1.0版）（${link(TEXT.sourcePdlUrl, TEXT.sourcePdlUrl)}）</span></p>
<p>${brand(esc(TEXT.noteProcessed))}</p>
</div>`;
}

function eventTime(ev, timezone) {
  if (ev.allDay) return TEXT.allDay;
  const s = formatHM(ev.start, timezone);
  return ev.end ? `${s}–${formatHM(ev.end, timezone)}` : s;
}

export function renderSchedule(s, { timezone }) {
  let body;
  if (s.state === "failed") {
    body = `<div class="alert"><p>${esc(TEXT.scheduleFailed)}</p></div>`;
  } else {
    const list = s.events.length
      ? `<ul class="events">${s.events.map((ev) => `<li><span class="ev-time">${esc(eventTime(ev, timezone))}</span><span class="ev-title">${esc(ev.title || TEXT.untitled)}</span></li>`).join("")}</ul>`
      : s.partial
        ? ""
        : `<p class="empty">${esc(TEXT.noEvents)}</p>`;
    body = list + (s.partial ? `<div class="alert"><p>${esc(TEXT.schedulePartial)}</p></div>` : "");
  }
  return `<section class="schedule" aria-labelledby="h-schedule">
<div class="sec-head"><h2 id="h-schedule">${esc(TEXT.scheduleHeading)}</h2></div>
${body}
</section>`;
}

function renderItem(item, now, timezone) {
  const href = safeHttpUrl(item.link);
  const title = href ? link(href, item.title) : `<span class="title">${esc(item.title)}</span>`;
  const time = `<time datetime="${esc(item.publishedAt.toISOString())}">${esc(formatHMWithDate(item.publishedAt, now, timezone))}</time>`;
  const desc = item.description ? `<p class="desc">${esc(item.description)}</p>` : "";
  return `<li>${title}${time}${desc}</li>`;
}

export function renderNews(news, { now, timezone, visibleItemsPerFeed }) {
  const feeds = news.feeds
    .map((f, i) => {
      let body;
      if (f.state === "failed") body = `<div class="alert"><p>${esc(TEXT.feedFailed)}</p></div>`;
      else if (f.items.length === 0) body = `<p class="empty">${esc(TEXT.feedEmpty)}</p>`;
      else {
        const shown = f.items.slice(0, visibleItemsPerFeed);
        const rest = f.items.slice(visibleItemsPerFeed);
        body = `<ul class="items">${shown.map((it) => renderItem(it, now, timezone)).join("")}</ul>`;
        if (rest.length) body += `<details><summary>${esc(TEXT.more(rest.length))}</summary><ul class="items">${rest.map((it) => renderItem(it, now, timezone)).join("")}</ul></details>`;
      }
      return `<section class="feed" aria-labelledby="h-feed-${i}"><h3 id="h-feed-${i}">${esc(f.name)}</h3>${body}</section>`;
    })
    .join("\n");
  return `<section class="news" aria-labelledby="h-news">
<div class="sec-head"><h2 id="h-news">${esc(TEXT.newsHeading)}</h2></div>
<div class="feeds">
${feeds}
</div>
</section>`;
}

export function render(view) {
  const { timezone, createdAt } = view;
  const today = ymd(createdAt, timezone);
  const p = dateLabelParts(today);
  const title = `${TEXT.pageTitle} ${today}（${p.weekday}）`;
  const hasNews = Boolean(view.news);
  const ctx = { now: createdAt, timezone, visibleItemsPerFeed: view.visibleItemsPerFeed ?? 4 };

  const weather = renderWeather(view.weather, ctx);
  const duoParts = [view.schedule ? renderSchedule(view.schedule, ctx) : "", hasNews ? renderNews(view.news, ctx) : ""].filter(Boolean);
  const duo = duoParts.length ? `<div class="duo duo-${duoParts.length}">\n${duoParts.join("\n")}\n</div>` : "";
  const main = [weather, duo].filter(Boolean).join("\n");
  const created = `${today} ${formatHM(createdAt, timezone)}`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="theme-color" content="#F5F1E8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1C1A17" media="(prefers-color-scheme: dark)">
<title>${esc(title)}</title>
<style>
${CSS}
</style>
</head>
<body>
<a class="skip" href="#main">${esc(TEXT.skip)}</a>
<div class="page ${hasNews ? "has-news" : "no-news"}">
<header class="masthead">
<h1>${esc(TEXT.pageTitle)}</h1>
<p class="year">${p.year}年</p>
<p class="date"><span>${p.month}月</span><span class="d">${p.day}</span><span>日（${esc(p.weekday)}）</span></p>
</header>
<main id="main">
${main}
</main>
<footer>
${renderCredits(view.weather)}
<p class="made">${brand(esc(TEXT.footer(view.version, created)))}</p>
</footer>
</div>
</body>
</html>
`;
}
