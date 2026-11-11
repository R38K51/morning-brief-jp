// 天気の欄：キャッシュと回数の判断 → 必要なら気象庁から取得 → 表示用のデータ。
// 失敗しても例外を投げず、state で返す（ほかの欄は動かす）。

import { MESSAGES as CONFIG_MESSAGES } from "../config.mjs";
import { fetchText, FetchError } from "../http.mjs";
import { jmaLocalParts, ymd } from "../time.mjs";
import { areaCacheFile, forecastCacheFile, readJson, requestLogFile, writeJsonAtomic } from "./cache.mjs";
import { extractForecast } from "./extract.mjs";
import { canUseStale, isReportOld, planWeather, requestsToday, validateCache } from "./policy.mjs";

export const FORECAST_URL = (code) => `https://www.jma.go.jp/bosai/forecast/data/forecast/${code}.json`;
export const AREA_URL = "https://www.jma.go.jp/bosai/common/const/area.json";
export const JMA_RETRY_DELAY_MS = 60_000;

export const WEATHER_MESSAGES = {
  fetching: "気象庁から取得しています…",
  failed: "気象庁のデータを取得できませんでした。設定の地域コードと通信を確かめて、時間をおいてもう一度実行してください。",
  limitWithCache: "本日の気象庁への取得回数の上限に達したため、前回取得分を使います。",
  limitNoCache: "本日の気象庁への取得回数の上限に達しました。天気の欄は取得できませんでした。",
  oldReport: (r) => `気象庁の発表が24時間より古いままです（発表：${r}）。`,
};

function reportLabel(reportDatetime) {
  const p = jmaLocalParts(reportDatetime);
  return p ? `${p.date} ${p.hm}` : String(reportDatetime);
}

/** 取得の失敗 → 画面の「原因：」の種類。404 は地域コード、つながらない（タイムアウトを含む）は接続、それ以外は想定外の応答。 */
export function causeOf(e, areaUnknown) {
  if (e instanceof FetchError) {
    if (e.kind === "http" && e.status === 404) return areaUnknown;
    if (e.kind === "network" || e.kind === "timeout") return { kind: "network" };
    if (e.kind === "http") return { kind: "unexpected", status: e.status };
  }
  return { kind: "unexpected", status: null };
}

/**
 * @returns view.weather
 */
export async function getWeather({ weather, cacheDir, timezone, now, fetchImpl, sleep, log }) {
  const { areaCode, areaName, tempPointName } = weather;
  const today = ymd(now, timezone);
  const base = { areaCode, failedAt: null, failReason: null, failCause: null, fetchedAt: null, office: null, reportDatetime: null, areaName: null, tempPointName: null, days: [] };

  const cacheFile = forecastCacheFile(cacheDir, areaCode);
  const logFile = requestLogFile(cacheDir);
  let cache = validateCache(await readJson(cacheFile), areaCode, now);
  if (cache) {
    // 中身が読めないキャッシュは無いものとして扱う
    try {
      extractForecast(cache.body, { areaName, tempPointName, today });
    } catch {
      cache = null;
    }
  }
  // 記録は2つ。requests は1日4回の枠に数える取得（再試行は同じ取得の一部で、数えない）。
  // sends は気象庁へ実際に送った数（再試行も1件ずつ）。sends は枠の判断には使わない。
  const logRaw = await readJson(logFile);
  let requests = requestsToday(logRaw?.requests, now, timezone);
  let sends = requestsToday(logRaw?.sends, now, timezone);

  const save = () => writeJsonAtomic(logFile, { requests, sends });
  // onAttempt(i)：i が 0（初回）なら枠を1つ使い、送信の記録も足す。i が 1（再試行）なら送信の記録だけ足す。
  const record = async (i) => {
    if (i === 0) requests = [...requests, now.toISOString()];
    sends = [...sends, now.toISOString()];
    await save();
  };

  const fromBody = (body, fetchedAt, state) => {
    const ex = extractForecast(body, { areaName, tempPointName, today });
    for (const n of ex.notices) log(n);
    return { ...base, state, fetchedAt, office: ex.office, reportDatetime: ex.reportDatetime, areaName: ex.areaName, tempPointName: ex.tempPointName, days: ex.days };
  };

  // cause（失敗の原因。画面の「原因：」の1行に使う。上限のときは null）：
  //   { kind: "area-unknown", code } | { kind: "network" } | { kind: "unexpected", status: number | null }
  const failed = (reason, cause = null) => ({ ...base, state: "failed", failReason: reason, failCause: reason === "limit" ? null : cause, failedAt: now });

  const fallback = (reason, cause = null) => {
    // reason: "error" | "limit"
    if (canUseStale(cache, now)) return fromBody(cache.body, cache.fetchedAt, "stale");
    return failed(reason, cause);
  };

  const areaUnknown = { kind: "area-unknown", code: areaCode };

  const plan = planWeather({ cache, requestCount: requests.length, now });

  if (plan.kind === "use-cache") {
    if (isReportOld(cache.reportDatetime, now)) log(WEATHER_MESSAGES.oldReport(reportLabel(cache.reportDatetime)));
    return fromBody(cache.body, cache.fetchedAt, "fresh");
  }

  if (plan.kind === "limit") {
    const out = fallback("limit");
    log(out.state === "stale" ? WEATHER_MESSAGES.limitWithCache : WEATHER_MESSAGES.limitNoCache);
    return out;
  }

  log(WEATHER_MESSAGES.fetching);
  let budget = plan.budget;

  // area.json：初回と地域コードを変えたときだけ。地域コードが offices にあるかの確かめにだけ使う。
  const areaCache = await readJson(areaCacheFile(cacheDir));
  if (!areaCache || areaCache.lastAreaCode !== areaCode || !Array.isArray(areaCache.offices)) {
    try {
      const r = await fetchText(AREA_URL, {
        fetchImpl,
        sleep,
        retries: 0,
        onAttempt: async (i) => {
          if (i === 0) budget -= 1;
          await record(i);
        },
      });
      const offices = Object.keys(JSON.parse(r.text)?.offices ?? {});
      if (offices.length > 0) {
        await writeJsonAtomic(areaCacheFile(cacheDir), { lastAreaCode: areaCode, fetchedAt: now.toISOString(), offices });
        if (!offices.includes(areaCode)) {
          log(CONFIG_MESSAGES.areaUnknown(areaCode));
          return failed("error", areaUnknown);
        }
      }
    } catch {
      // area.json が取れなければ確かめを飛ばして予報を取りに行く
    }
  } else if (!areaCache.offices.includes(areaCode)) {
    log(CONFIG_MESSAGES.areaUnknown(areaCode));
    return failed("error", areaUnknown);
  }

  if (budget <= 0) {
    const out = fallback("limit");
    log(out.state === "stale" ? WEATHER_MESSAGES.limitWithCache : WEATHER_MESSAGES.limitNoCache);
    return out;
  }

  let text;
  try {
    const r = await fetchText(FORECAST_URL(areaCode), {
      fetchImpl,
      sleep,
      retries: 1, // 再試行は同じ取得の一部（枠は1つだけ使う）。残りが1回でも再試行する
      retryDelayMs: JMA_RETRY_DELAY_MS,
      onAttempt: record,
    });
    text = r.text;
  } catch (e) {
    const cause = causeOf(e, areaUnknown);
    if (cause.kind === "area-unknown") log(CONFIG_MESSAGES.areaUnknown(areaCode));
    else log(WEATHER_MESSAGES.failed);
    return fallback("error", cause);
  }

  let body;
  let view;
  try {
    body = JSON.parse(text);
    view = fromBody(body, now, "fresh");
  } catch {
    // JSON として読めない、または形が違う（HTTP は 200 なので番号は出さない）
    log(WEATHER_MESSAGES.failed);
    return fallback("error", { kind: "unexpected", status: null });
  }
  await writeJsonAtomic(cacheFile, { areaCode, fetchedAt: now.toISOString(), reportDatetime: view.reportDatetime, body });
  if (isReportOld(view.reportDatetime, now)) log(WEATHER_MESSAGES.oldReport(reportLabel(view.reportDatetime)));
  return view;
}
