// 設定の読み込み、検査、既定値。設定の誤りは ConfigError（実行を止める）。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { isValidTimeZone } from "./time.mjs";

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

export const MESSAGES = {
  notFound: "config.json が見つかりません。config.example.json を config.json という名前でコピーしてください。",
  badJson: (line) => `config.json の ${line} 行目付近を確かめてください（JSON として読めません）。`,
  areaEmpty:
    "weather.areaCode が設定されていません。気象庁の天気予報ページのアドレスにある area_code の数字を入れてください（東京都の例：130000）。",
  areaUnknown: (code) => `地域コード ${code} が気象庁のデータにありません。weather.areaCode を確かめてください。`,
  badValue: (key, def) => `config.json の ${key} の値を確かめてください。既定値（${def}）を使います。`,
};

const DEFAULTS = {
  icalUrlEnv: "MORNING_BRIEF_ICAL_URL",
  sinceHour: 6,
  visibleItemsPerFeed: 4,
  maxItemsPerFeed: 10,
  outputPath: "./out/morning-brief.html",
  timezone: "Asia/Tokyo",
};

/** JSON.parse のエラーから行番号を出す。 */
export function jsonErrorLine(text, error) {
  const msg = String(error?.message ?? "");
  const byLine = /line (\d+)/i.exec(msg);
  if (byLine) return Number(byLine[1]);
  const byPos = /position (\d+)/i.exec(msg);
  if (byPos) {
    const pos = Math.min(Number(byPos[1]), text.length);
    return text.slice(0, pos).split("\n").length;
  }
  return 1;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function intInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 設定の中身（オブジェクト）を検査し、既定値を入れた形にする。
 * notices にはコンソールに出す知らせを入れる。
 */
export function normalizeConfig(raw, baseDir) {
  const notices = [];
  if (!isPlainObject(raw)) throw new ConfigError(MESSAGES.badJson(1));

  const weather = isPlainObject(raw.weather) ? raw.weather : {};
  const areaCode = typeof weather.areaCode === "string" ? weather.areaCode.trim() : weather.areaCode == null ? "" : String(weather.areaCode).trim();
  if (areaCode === "") throw new ConfigError(MESSAGES.areaEmpty);
  if (!/^\d{6}$/.test(areaCode)) throw new ConfigError(MESSAGES.areaUnknown(areaCode));

  const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

  const schedule = isPlainObject(raw.schedule) ? raw.schedule : {};
  const icalUrlEnv = str(schedule.icalUrlEnv) ?? DEFAULTS.icalUrlEnv;

  const feeds = [];
  if (Array.isArray(raw.feeds)) {
    for (const f of raw.feeds) {
      if (!isPlainObject(f)) continue;
      const url = typeof f.url === "string" ? f.url.trim() : "";
      if (url === "") continue; // URL が空のフィードは何も言わずに飛ばす
      feeds.push({ name: str(f.name) ?? url, url });
    }
  }

  const rss = isPlainObject(raw.rss) ? raw.rss : {};
  const pick = (value, key, def, ok) => {
    if (value === undefined) return def;
    if (ok(value)) return value;
    notices.push(MESSAGES.badValue(key, def));
    return def;
  };
  const sinceHour = pick(rss.sinceHour, "rss.sinceHour", DEFAULTS.sinceHour, (v) => intInRange(v, 0, 23));
  const visibleItemsPerFeed = pick(rss.visibleItemsPerFeed, "rss.visibleItemsPerFeed", DEFAULTS.visibleItemsPerFeed, (v) => intInRange(v, 1, 100));
  const maxItemsPerFeed = pick(rss.maxItemsPerFeed, "rss.maxItemsPerFeed", DEFAULTS.maxItemsPerFeed, (v) => intInRange(v, 1, 200));
  const timezone = pick(raw.timezone, "timezone", DEFAULTS.timezone, (v) => typeof v === "string" && isValidTimeZone(v));

  const output = isPlainObject(raw.output) ? raw.output : {};
  const outputPath = path.resolve(baseDir, str(output.path) ?? DEFAULTS.outputPath);

  // summary の項目は初版では読まない（技術設計の6）。
  return {
    config: {
      baseDir,
      weather: { areaCode, areaName: str(weather.areaName), tempPointName: str(weather.tempPointName) },
      schedule: { enabled: schedule.enabled === true, icalUrlEnv },
      feeds,
      rss: { sinceHour, visibleItemsPerFeed, maxItemsPerFeed: Math.max(maxItemsPerFeed, 1) },
      outputPath,
      timezone,
      cacheDir: path.join(baseDir, ".cache"),
    },
    notices,
  };
}

/** 設定ファイルを読む。 */
export async function loadConfig(configPath) {
  const abs = path.resolve(configPath);
  let text;
  try {
    text = await readFile(abs, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") throw new ConfigError(MESSAGES.notFound);
    throw e;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM つきでも読む
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(MESSAGES.badJson(jsonErrorLine(text, e)));
  }
  return normalizeConfig(raw, path.dirname(abs));
}
