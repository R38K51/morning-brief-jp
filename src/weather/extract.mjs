// 気象庁の予報 JSON → 表示用のデータ。通信しない純粋な関数。
// 値は数値に変えず、気象庁の文字列のまま持つ（天気仕様「数値を変えずに」）。
// まとめ値、補完、アイコン、助言、警報は作らない。

import { addDays, jmaLocalParts } from "../time.mjs";

export class ExtractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtractError";
  }
}

/** 空白の整理だけ：連続した空白を1つにする（全角の空白を含むときは全角1つ）。 */
export function tidySpaces(s) {
  return String(s ?? "")
    .replace(/\s+/g, (m) => (m.includes("　") ? "　" : " "))
    .trim();
}

/** 空文字や無い値は null（画面では「—（発表なし）」）。それ以外は文字列のまま。 */
function rawValue(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function pickArea(areas, wantedName, wantedCode) {
  if (!Array.isArray(areas) || areas.length === 0) return { area: null, matched: false };
  if (wantedCode) {
    const byCode = areas.find((a) => a?.area?.code === wantedCode);
    if (byCode) return { area: byCode, matched: true };
  }
  if (wantedName) {
    const byName = areas.find((a) => a?.area?.name === wantedName);
    if (byName) return { area: byName, matched: true };
  }
  return { area: areas[0], matched: false };
}

/**
 * 降水確率の時間帯。始まりは timeDefines、終わりは次の timeDefines から出す。
 * - 次が同じ日 → その時刻（12–18時）
 * - 次が翌日の0時 → 24時（18–24時）
 * - 次が無い最後の時間帯：前の区切りがすべて6時間おきなら +6時間（18–24時）。そうでなければ終わりなし（18時〜）
 * - 日をまたぐ（次が翌日0時以外） → 終わりなし（18時〜）
 * 時刻に分が付くとき（例：12:30）は分を捨てず "12:30" の形で持つ（時刻を変えて出さないため）。
 */
/** 時刻の表記：分が0なら時だけ（"12"）、分があれば "12:30"。 */
const clock = (p) => (p.minute === 0 ? String(p.hour) : `${p.hour}:${String(p.minute).padStart(2, "0")}`);

export function popSlots(timeDefines, pops) {
  const out = [];
  if (!Array.isArray(timeDefines)) return out;
  for (let i = 0; i < timeDefines.length; i++) {
    const cur = jmaLocalParts(timeDefines[i]);
    if (!cur) continue;
    const next = i + 1 < timeDefines.length ? jmaLocalParts(timeDefines[i + 1]) : null;
    let to = null;
    if (next) {
      const curMin = cur.hour * 60 + cur.minute;
      const nextMin = next.hour * 60 + next.minute;
      if (next.date === cur.date && nextMin > curMin) to = clock(next);
      else if (next.date === addDays(cur.date, 1) && next.hour === 0 && next.minute === 0) to = "24";
    }
    if (!next && i === timeDefines.length - 1 && allSixHourly(timeDefines)) to = sixHoursAfter(cur);
    out.push({
      date: cur.date,
      from: clock(cur),
      to,
      value: rawValue(Array.isArray(pops) ? pops[i] : undefined),
    });
  }
  return out;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/** 区切りが2つ以上あり、前の区切りがすべて6時間おきか（最後の時間帯に +6時間を足してよい条件。設計書の降水確率）。 */
function allSixHourly(timeDefines) {
  if (timeDefines.length < 2) return false;
  for (let i = 1; i < timeDefines.length; i++) {
    const a = Date.parse(timeDefines[i - 1]);
    const b = Date.parse(timeDefines[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b - a !== SIX_HOURS_MS) return false;
  }
  return true;
}

/** 始まりの6時間後。同じ日に収まればその時刻、ちょうど翌日0時なら "24"、それより後なら null（終わりを決めない）。 */
function sixHoursAfter(cur) {
  const end = cur.hour * 60 + cur.minute + 360;
  if (end < 1440) return clock({ hour: Math.floor(end / 60), minute: end % 60 });
  if (end === 1440) return "24";
  return null;
}

/**
 * 気温。欄は timeDefines の時刻で決める（00:00＝最低、09:00＝最高）。配列の順には頼らない。
 * 最低（D日 00:00）は、発表時刻が D日 00:00 以降なら出さない（dev-checker 3回目）。比べるのは時刻だけ。
 */
export function tempsByDate(timeDefines, temps, reportDatetime) {
  const byDate = new Map();
  const report = Date.parse(reportDatetime);
  if (!Array.isArray(timeDefines)) return byDate;
  for (let i = 0; i < timeDefines.length; i++) {
    const p = jmaLocalParts(timeDefines[i]);
    if (!p || p.minute !== 0) continue;
    const slot = byDate.get(p.date) ?? { min: null, max: null };
    const value = rawValue(Array.isArray(temps) ? temps[i] : undefined);
    if (p.hour === 0) {
      const defined = Date.parse(timeDefines[i]);
      const sameDayOrLater = Number.isFinite(report) && Number.isFinite(defined) && report >= defined;
      slot.min = sameDayOrLater ? null : value;
      // 決まりで消した値があったか（「項目がすべて空の日」の判定は消す前の値で行う。dev-checker の直すとよいこと）
      if (sameDayOrLater && value !== null) slot.minHidden = true;
    } else if (p.hour === 9) {
      slot.max = value;
    }
    byDate.set(p.date, slot);
  }
  return byDate;
}

/**
 * @param body 気象庁の JSON（配列）。使うのは [0] だけ。
 * @param opts { areaName, tempPointName, today: "YYYY-MM-DD" }
 */
export function extractForecast(body, { areaName = null, tempPointName = null, today }) {
  const notices = [];
  const short = Array.isArray(body) ? body[0] : null;
  if (!short || !Array.isArray(short.timeSeries)) throw new ExtractError("形が違う");
  const reportDatetime = typeof short.reportDatetime === "string" ? short.reportDatetime : null;
  if (!reportDatetime || !jmaLocalParts(reportDatetime)) throw new ExtractError("発表時刻が無い");
  const office = typeof short.publishingOffice === "string" ? short.publishingOffice : null;

  // 天気の文と日付（timeSeries の中で weathers を持つもの）
  const wxSeries = short.timeSeries.find((ts) => Array.isArray(ts?.areas) && ts.areas.some((a) => Array.isArray(a?.weathers)));
  if (!wxSeries) throw new ExtractError("天気の文が無い");
  const wx = pickArea(wxSeries.areas, areaName, null);
  if (areaName && !wx.matched) notices.push(`weather.areaName「${areaName}」が気象庁のデータにないため、「${wx.area?.area?.name ?? ""}」を出します。`);
  const areaCodeInJson = wx.area?.area?.code ?? null;

  const popSeries = short.timeSeries.find((ts) => Array.isArray(ts?.areas) && ts.areas.some((a) => Array.isArray(a?.pops)));
  const popArea = popSeries ? pickArea(popSeries.areas, wx.area?.area?.name ?? null, areaCodeInJson).area : null;
  const slots = popSeries ? popSlots(popSeries.timeDefines, popArea?.pops) : [];

  const tempSeries = short.timeSeries.find((ts) => Array.isArray(ts?.areas) && ts.areas.some((a) => Array.isArray(a?.temps)));
  let tempPoint = null;
  let temps = new Map();
  if (tempSeries) {
    const tp = pickArea(tempSeries.areas, tempPointName, null);
    if (tempPointName && !tp.matched) notices.push(`weather.tempPointName「${tempPointName}」が気象庁のデータにないため、「${tp.area?.area?.name ?? ""}」を出します。`);
    tempPoint = tp.area?.area?.name ?? null;
    temps = tempsByDate(tempSeries.timeDefines, tp.area?.temps, reportDatetime);
  }

  // 日ごと：今日以降の日を前から2日分。今日以降が無ければ JSON の先頭から2日分。
  const allDays = [];
  (wxSeries.timeDefines ?? []).forEach((td, i) => {
    const p = jmaLocalParts(td);
    if (!p) return;
    if (allDays.some((d) => d.date === p.date)) return;
    allDays.push({ date: p.date, weather: rawValue(wx.area?.weathers?.[i]) });
  });
  let chosen = allDays.filter((d) => d.date >= today).slice(0, 2);
  if (chosen.length === 0) chosen = allDays.slice(0, 2);
  const tomorrow = addDays(today, 1);

  const days = chosen.map((d) => {
    const t = temps.get(d.date) ?? { min: null, max: null };
    return {
      date: d.date,
      label: d.date === today ? "今日" : d.date === tomorrow ? "明日" : null,
      weather: d.weather === null ? null : tidySpaces(d.weather),
      pops: slots.filter((s) => s.date === d.date).map(({ from, to, value }) => ({ from, to, value })),
      tempMin: t.min,
      tempMinHidden: t.minHidden === true,
      tempMax: t.max,
    };
  });

  return { office, reportDatetime, areaName: wx.area?.area?.name ?? null, tempPointName: tempPoint, days, notices };
}
