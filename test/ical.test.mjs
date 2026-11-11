import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { todaysEvents } from "../src/ical.mjs";
import { formatHM } from "../src/time.mjs";

const read = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const TZ = "Asia/Tokyo";
const show = (r) => r.events.map((e) => [e.allDay ? "終日" : formatHM(e.start, TZ) + (e.end ? "–" + formatHM(e.end, TZ) : ""), e.title]);

test("今日の予定：単発、終日、毎日、変えた回、毎週、第2水曜、UTC、地域なし、題名なし。並びは終日が先頭", async () => {
  const r = todaysEvents(await read("calendar.ics"), { today: "2026-11-11", timeZone: TZ });
  assert.equal(r.partial, false);
  assert.deepEqual(show(r), [
    ["終日", "終日の例"],
    ["08:00–08:30", "毎日の例（変更）"],
    ["09:30–10:30", "会議の例"],
    ["12:00–12:30", "UTCの例"],
    ["13:00–14:00", "毎週水曜の例"],
    ["15:00–16:00", "第2水曜の例"],
    ["17:00", "地域なしの例"],
    ["18:00–18:30", ""],
  ]);
});

test("除外日、取り消し、別の曜日、明日の予定は出ない", async () => {
  const r = todaysEvents(await read("calendar.ics"), { today: "2026-11-11", timeZone: TZ });
  const titles = r.events.map((e) => e.title);
  for (const t of ["除外の例", "取り消しの例", "木曜の例", "明日の例", "毎日の例"]) assert.equal(titles.includes(t), false, t);
});

test("翌日は別の予定になる（毎日は元の時刻、第2水曜は無い）", async () => {
  const r = todaysEvents(await read("calendar.ics"), { today: "2026-11-12", timeZone: TZ });
  assert.deepEqual(show(r), [
    ["07:00–07:30", "毎日の例"],
    ["09:00–10:00", "明日の例"],
    ["10:00–11:00", "木曜の例"],
  ]);
});

test("場所などは読まない", async () => {
  const r = todaysEvents(await read("calendar.ics"), { today: "2026-11-11", timeZone: TZ });
  assert.equal(JSON.stringify(r).includes("読まない場所"), false);
});

test("TZID を解決できない予定は飛ばし、partial を立てる", async () => {
  const r = todaysEvents(await read("calendar-unknown-tz.ics"), { today: "2026-11-11", timeZone: TZ });
  assert.equal(r.partial, true);
  assert.deepEqual(show(r), [["10:00–11:00", "作業の例"]]);
});

test("壊れた iCal は例外（呼ぶ側で失敗の表示にする）", () => {
  assert.throws(() => todaysEvents("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:xx\n", { today: "2026-11-11", timeZone: TZ }));
});
