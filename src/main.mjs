// 全体の流れ：設定 → 天気・予定・各フィードを並行に取得 → 1枚の HTML を書き出す。
// 止めるのは設定の誤りのときだけ（終了コード 1）。取得の失敗では HTML を書いて終了コード 0。

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConfigError, loadConfig } from "./config.mjs";
import { fetchText, realSleep, VERSION } from "./http.mjs";
import { todaysEvents } from "./ical.mjs";
import { render } from "./render.mjs";
import { parseFeed, selectItems } from "./rss.mjs";
import { safeHttpUrl } from "./escape.mjs";
import { sinceThreshold, ymd } from "./time.mjs";
import { getWeather } from "./weather/index.mjs";

export const MAIN_MESSAGES = {
  icalEnvEmpty: (name) => `環境変数 ${name} が空です。予定の欄は出しません。`,
  badFeedUrl: (name) => `フィード「${name}」の URL を確かめてください。`,
  fetchingNews: (n) => `ニュースを取得しています…（${n}件のフィード）`,
  done: (p) => `朝のまとめを作りました：${p}`,
  sections: (list) => `欄：${list.join(" / ")}`,
};

const OTHER_RETRY_DELAY_MS = 5_000;

async function getSchedule({ url, today, timezone, fetchImpl, sleep }) {
  try {
    const r = await fetchText(url, { fetchImpl, sleep, retries: 1, retryDelayMs: OTHER_RETRY_DELAY_MS });
    const { events, partial } = todaysEvents(r.text, { today, timeZone: timezone });
    return { state: "ok", events, partial };
  } catch {
    // エラーの文（e.message、e.cause）は URL を含むおそれがあるので出さない
    return { state: "failed", events: [], partial: false };
  }
}

async function getFeed({ feed, since, max, fetchImpl, sleep }) {
  try {
    const r = await fetchText(feed.url, { fetchImpl, sleep, retries: 1, retryDelayMs: OTHER_RETRY_DELAY_MS });
    return { name: feed.name, state: "ok", items: selectItems(parseFeed(r.text), since, max) };
  } catch {
    return { name: feed.name, state: "failed", items: [] };
  }
}

async function writeAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

/**
 * @returns { exitCode, outputPath? }
 */
export async function run({ configPath, now = new Date(), fetchImpl = globalThis.fetch, sleep = realSleep, env = process.env, log = console.log }) {
  let config;
  try {
    const loaded = await loadConfig(configPath);
    config = loaded.config;
    for (const n of loaded.notices) log(n);
  } catch (e) {
    if (e instanceof ConfigError) {
      log(e.message);
      return { exitCode: 1 };
    }
    throw e;
  }

  const { timezone } = config;
  const today = ymd(now, timezone);

  // 予定：有効で、環境変数に値があるときだけ。URL は出さない。
  let icalUrl = null;
  if (config.schedule.enabled) {
    const raw = (env[config.schedule.icalUrlEnv] ?? "").trim();
    if (raw === "") log(MAIN_MESSAGES.icalEnvEmpty(config.schedule.icalUrlEnv));
    else icalUrl = raw.replace(/^webcal:/i, "https:");
  }

  // フィード：URL が不正なものは取りに行かず、失敗として出す。
  const feedJobs = [];
  for (const feed of config.feeds) {
    if (!safeHttpUrl(feed.url)) {
      log(MAIN_MESSAGES.badFeedUrl(feed.name));
      feedJobs.push(Promise.resolve({ name: feed.name, state: "failed", items: [] }));
    } else {
      feedJobs.push(null);
    }
  }
  const realFeeds = config.feeds.filter((_, i) => feedJobs[i] === null);
  if (realFeeds.length > 0) log(MAIN_MESSAGES.fetchingNews(config.feeds.length));
  const since = sinceThreshold(now, timezone, config.rss.sinceHour);
  config.feeds.forEach((feed, i) => {
    if (feedJobs[i] === null) feedJobs[i] = getFeed({ feed, since, max: config.rss.maxItemsPerFeed, fetchImpl, sleep });
  });

  const [weatherR, scheduleR, ...feedRs] = await Promise.allSettled([
    getWeather({ weather: config.weather, cacheDir: config.cacheDir, timezone, now, fetchImpl, sleep, log }),
    icalUrl ? getSchedule({ url: icalUrl, today, timezone, fetchImpl, sleep }) : Promise.resolve(null),
    ...feedJobs,
  ]);

  const weather =
    weatherR.status === "fulfilled"
      ? weatherR.value
      : { state: "failed", failReason: "error", failCause: null, failedAt: now, areaCode: config.weather.areaCode, fetchedAt: null, office: null, reportDatetime: null, areaName: null, tempPointName: null, days: [] };
  const schedule = scheduleR.status === "fulfilled" ? scheduleR.value : icalUrl ? { state: "failed", events: [], partial: false } : null;
  const feeds = feedRs.map((r, i) => (r.status === "fulfilled" ? r.value : { name: config.feeds[i].name, state: "failed", items: [] }));
  const news = feeds.length > 0 ? { feeds } : null;

  const view = { version: VERSION, createdAt: now, timezone, weather, schedule, news, visibleItemsPerFeed: config.rss.visibleItemsPerFeed };
  const html = render(view);
  await writeAtomic(config.outputPath, html);

  const sections = ["天気"];
  if (schedule) sections.push("予定");
  if (news) sections.push(`ニュース（${feeds.length}件のフィード）`);
  log(MAIN_MESSAGES.done(config.outputPath));
  log(MAIN_MESSAGES.sections(sections));
  return { exitCode: 0, outputPath: config.outputPath, view };
}
