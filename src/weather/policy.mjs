// 天気のキャッシュと回数の判断。通信もファイルの読み書きもしない（天気仕様の3、技術設計の2）。
// 3時間は取得時刻（fetchedAt）から、24時間は発表時刻（reportDatetime）から数える。

import { ymd } from "../time.mjs";

export const FRESH_MS = 3 * 60 * 60 * 1000;
export const STALE_MAX_MS = 24 * 60 * 60 * 1000;
export const DAILY_LIMIT = 4;

const toTime = (v) => {
  if (typeof v !== "string" || v === "") return NaN;
  return Date.parse(v);
};

/**
 * キャッシュのファイルの中身を検査する。使えなければ null（無いものとして扱う）。
 * - 地域コードが違う、body が無い、fetchedAt か reportDatetime が読めない、
 *   reportDatetime か fetchedAt が未来、のどれかなら使わない。
 */
export function validateCache(raw, areaCode, now) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.areaCode !== areaCode) return null;
  if (!Array.isArray(raw.body) || raw.body.length === 0) return null;
  const fetchedAt = toTime(raw.fetchedAt);
  const report = toTime(raw.reportDatetime);
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(report)) return null;
  const n = now.getTime();
  if (report > n || fetchedAt > n) return null;
  return { areaCode, fetchedAt: new Date(fetchedAt), reportDatetime: raw.reportDatetime, body: raw.body };
}

/** 今日（設定の timezone）の取得の記録だけを残す。読めない記録は捨てる。 */
export function requestsToday(requests, now, timeZone) {
  if (!Array.isArray(requests)) return [];
  const today = ymd(now, timeZone);
  return requests.filter((r) => {
    const t = toTime(r);
    return Number.isFinite(t) && t <= now.getTime() && ymd(new Date(t), timeZone) === today;
  });
}

/**
 * 取りに行くかを決める。
 * 戻り値：{ kind: "use-cache" } | { kind: "limit" } | { kind: "fetch", budget }
 */
export function planWeather({ cache, requestCount, now }) {
  if (cache && now.getTime() - cache.fetchedAt.getTime() <= FRESH_MS) return { kind: "use-cache" };
  if (requestCount >= DAILY_LIMIT) return { kind: "limit" };
  return { kind: "fetch", budget: DAILY_LIMIT - requestCount };
}

/** 取得に失敗したか上限のとき、キャッシュを出せるか（発表から24時間以内）。 */
export function canUseStale(cache, now) {
  if (!cache) return false;
  return now.getTime() - Date.parse(cache.reportDatetime) <= STALE_MAX_MS;
}

/** 発表が24時間より古いか（新しく取れた場合と3時間以内のキャッシュで、知らせるため）。 */
export function isReportOld(reportDatetime, now) {
  const t = toTime(reportDatetime);
  return Number.isFinite(t) && now.getTime() - t > STALE_MAX_MS;
}
