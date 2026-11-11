// 時刻の部品。「今日」「前日6時」は PC の時計の地域ではなく、設定の timezone で数える。

const partsCache = new Map();

function partsFormatter(timeZone) {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** 設定の timezone として使えるか。 */
export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Date を timezone の年月日時分秒（数値）に分ける。 */
export function zonedParts(date, timeZone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

const pad2 = (n) => String(n).padStart(2, "0");

/** timezone での日付 "YYYY-MM-DD"。 */
export function ymd(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** "YYYY-MM-DD" に日数を足す（暦の上の計算）。 */
export function addDays(ymdString, days) {
  const [y, m, d] = ymdString.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** timezone の壁時計の時刻を、実際の時刻（Date）に直す。 */
export function zonedTimeToDate({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = asUtc;
  // 2回回せば夏時間の切り替えの前後でも収まる。
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = shown - asUtc;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

/** "YYYY-MM-DD" の0時（timezone）。 */
export function startOfDay(ymdString, timeZone) {
  const [year, month, day] = ymdString.split("-").map(Number);
  return zonedTimeToDate({ year, month, day }, timeZone);
}

/** 前日の hour 時（timezone）。RSS の絞り込みに使う。 */
export function sinceThreshold(now, timeZone, hour) {
  const yesterday = addDays(ymd(now, timeZone), -1);
  const [year, month, day] = yesterday.split("-").map(Number);
  return zonedTimeToDate({ year, month, day, hour }, timeZone);
}

/** "HH:MM"（timezone）。 */
export function formatHM(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** 今日なら "HH:MM"、違う日なら "MM-DD HH:MM"。 */
export function formatHMWithDate(date, now, timeZone) {
  const p = zonedParts(date, timeZone);
  const hm = `${pad2(p.hour)}:${pad2(p.minute)}`;
  if (ymd(date, timeZone) === ymd(now, timeZone)) return hm;
  return `${pad2(p.month)}-${pad2(p.day)} ${hm}`;
}

const weekdayFmt = new Intl.DateTimeFormat("ja-JP", { weekday: "short", timeZone: "UTC" });

/** "YYYY-MM-DD" の曜日（"水" など）。暦の日付として扱う。 */
export function weekdayOf(ymdString) {
  const [y, m, d] = ymdString.split("-").map(Number);
  return weekdayFmt.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** "YYYY-MM-DD" → { year, month, day, weekday }（表示用）。 */
export function dateLabelParts(ymdString) {
  const [year, month, day] = ymdString.split("-").map(Number);
  return { year, month, day, weekday: weekdayOf(ymdString) };
}

/**
 * 気象庁の時刻の文字列（"2026-11-11T11:00:00+09:00"）から、発表されたままの
 * 日付と時分を取り出す。地域時刻に直さない（発表の表記を変えないため）。
 */
export function jmaLocalParts(isoString) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(isoString ?? ""));
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, hour: Number(m[4]), minute: Number(m[5]), hm: `${m[4]}:${m[5]}` };
}
