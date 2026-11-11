// iCal の読み取りと、今日（設定の timezone）の予定の取り出し。繰り返しは ical.js で展開する。
// 場所、参加者、説明は読まない。TZID を解決できない予定は飛ばし、partial を立てる。

import ICAL from "ical.js";
import { addDays, startOfDay, zonedTimeToDate } from "./time.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ITERATIONS = 50_000; // 無限に展開しないための上限
const LOOKAHEAD_MS = 31 * DAY_MS; // 別の日へ動かした回（RECURRENCE-ID）を拾うための余裕
const TIME_PROPS = ["dtstart", "dtend", "recurrence-id", "exdate", "rdate"];
const UTC_IDS = new Set(["UTC", "Z", "GMT"]);

class UnresolvedZone extends Error {}

function hasUnresolvedZone(vevent) {
  for (const name of TIME_PROPS) {
    for (const prop of vevent.getAllProperties(name)) {
      const tzid = prop.getParameter("tzid");
      if (!tzid || UTC_IDS.has(tzid)) continue;
      if (vevent.getTimeZoneByID(tzid)) continue;
      if (ICAL.TimezoneService.has(tzid)) continue;
      return true;
    }
  }
  return false;
}

function isCancelled(component) {
  const s = component.getFirstPropertyValue("status");
  return typeof s === "string" && s.toUpperCase() === "CANCELLED";
}

function isFloating(time) {
  return time.zone === ICAL.Timezone.localTimezone || time.zone?.tzid === "floating";
}

/** ICAL.Time → Date。時刻の地域が無いもの（floating）は設定の timezone の壁時計として読む。 */
function toDate(time, timeZone) {
  if (isFloating(time)) {
    return zonedTimeToDate({ year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second }, timeZone);
  }
  return new Date(time.toUnixTime() * 1000);
}

const pad2 = (n) => String(n).padStart(2, "0");
const timeYmd = (t) => `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;

function occurrence({ startTime, endTime, title }, ctx) {
  const { today, dayStart, dayEnd, timeZone } = ctx;
  if (startTime.isDate) {
    const s = timeYmd(startTime);
    const e = endTime && endTime.isDate ? timeYmd(endTime) : addDays(s, 1);
    const end = e > s ? e : addDays(s, 1);
    if (s <= today && today < end) return { allDay: true, start: dayStart, end: null, title };
    return null;
  }
  const start = toDate(startTime, timeZone);
  const end = endTime ? toDate(endTime, timeZone) : null;
  const hasLength = end && end.getTime() > start.getTime();
  const overlaps = hasLength
    ? start < dayEnd && end > dayStart
    : start >= dayStart && start < dayEnd;
  if (!overlaps) return null;
  return { allDay: false, start, end: hasLength ? end : null, title };
}

const summaryOf = (component) => {
  const s = component.getFirstPropertyValue("summary");
  return typeof s === "string" ? s.trim() : "";
};

/**
 * @param icsText iCal の文字列
 * @param opts { today: "YYYY-MM-DD", timeZone }
 * @returns { events: [{ allDay, start, end, title }], partial: boolean }
 */
export function todaysEvents(icsText, { today, timeZone }) {
  const parsed = ICAL.parse(icsText);
  const roots = (Array.isArray(parsed) && typeof parsed[0] !== "string" ? parsed : [parsed]).map((j) => new ICAL.Component(j));
  const vevents = roots.flatMap((r) => (r.name === "vevent" ? [r] : r.getAllSubcomponents("vevent")));

  const ctx = { today, timeZone, dayStart: startOfDay(today, timeZone), dayEnd: startOfDay(addDays(today, 1), timeZone) };
  const masters = [];
  const exceptionsByUid = new Map();
  for (const v of vevents) {
    if (v.hasProperty("recurrence-id")) {
      const uid = v.getFirstPropertyValue("uid") ?? "";
      if (!exceptionsByUid.has(uid)) exceptionsByUid.set(uid, []);
      exceptionsByUid.get(uid).push(v);
    } else masters.push(v);
  }
  const masterUids = new Set(masters.map((m) => m.getFirstPropertyValue("uid") ?? ""));

  const events = [];
  let partial = false;

  const addSingle = (component) => {
    if (isCancelled(component)) return;
    const ev = new ICAL.Event(component, { exceptions: [] });
    const o = occurrence({ startTime: ev.startDate, endTime: ev.endDate, title: summaryOf(component) }, ctx);
    if (o) events.push(o);
  };

  for (const master of masters) {
    try {
      const uid = master.getFirstPropertyValue("uid") ?? "";
      const exceptions = exceptionsByUid.get(uid) ?? [];
      if (hasUnresolvedZone(master) || exceptions.some(hasUnresolvedZone)) throw new UnresolvedZone();
      if (!master.getFirstProperty("dtstart")) continue;
      const ev = new ICAL.Event(master, { exceptions, strictExceptions: true });
      if (!ev.isRecurring()) {
        addSingle(master);
        continue;
      }
      if (isCancelled(master)) continue;
      const it = ev.iterator();
      const stopAt = ctx.dayEnd.getTime() + LOOKAHEAD_MS;
      let next;
      let n = 0;
      while ((next = it.next()) && n++ < MAX_ITERATIONS) {
        if (toDate(next, timeZone).getTime() >= stopAt) break;
        const d = ev.getOccurrenceDetails(next);
        if (isCancelled(d.item.component)) continue;
        const o = occurrence({ startTime: d.startDate, endTime: d.endDate, title: summaryOf(d.item.component) }, ctx);
        if (o) events.push(o);
      }
    } catch {
      partial = true; // 読めない予定は飛ばす（中身や URL は出さない）
    }
  }

  // 元の予定が無い RECURRENCE-ID は単発として扱う
  for (const [uid, list] of exceptionsByUid) {
    if (masterUids.has(uid)) continue;
    for (const v of list) {
      try {
        if (hasUnresolvedZone(v)) throw new UnresolvedZone();
        addSingle(v);
      } catch {
        partial = true;
      }
    }
  }

  events.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.start - b.start));
  return { events, partial };
}
