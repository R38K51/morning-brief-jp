import { test } from "node:test";
import assert from "node:assert/strict";
import { extractForecast, popSlots, tempsByDate, tidySpaces } from "../src/weather/extract.mjs";
import { jma0500, jma1100, jma1700 } from "./fixtures/jma.mjs";

const opts = { areaName: "東京地方", tempPointName: "東京", today: "2026-11-11" };

test("11:00 発表：今日と明日の2日分、天気の文はそのまま", () => {
  const r = extractForecast(jma1100(), opts);
  assert.equal(r.office, "気象庁");
  assert.equal(r.reportDatetime, "2026-11-11T11:00:00+09:00");
  assert.equal(r.areaName, "東京地方");
  assert.equal(r.tempPointName, "東京");
  assert.deepEqual(r.days.map((d) => [d.date, d.label]), [["2026-11-11", "今日"], ["2026-11-12", "明日"]]);
  assert.equal(r.days[0].weather, "見本の天気　のち　見本");
  assert.equal(r.days[1].weather, "見本　時々　見本の雨");
});

test("降水確率：終わりは次の timeDefines、翌日0時なら24時、最後は始めだけ", () => {
  const r = extractForecast(jma1100(), opts);
  assert.deepEqual(r.days[0].pops, [
    { from: "12", to: "18", value: "0" },
    { from: "18", to: "24", value: "10" },
  ]);
  assert.deepEqual(r.days[1].pops, [
    { from: "0", to: "6", value: "20" },
    { from: "6", to: "12", value: "30" },
    { from: "12", to: "18", value: "40" },
    { from: "18", to: null, value: "50" },
  ]);
});

test("JSON に無い時間帯は作らない（11:00 発表に今日の 0–6時・6–12時は無い）", () => {
  const r = extractForecast(jma1100(), opts);
  assert.equal(r.days[0].pops.some((p) => p.from === "0" || p.from === "6"), false);
});

test("日をまたぐ区間（次が翌日の0時以外）は終わりを決めない", () => {
  const s = popSlots(["2026-11-11T18:00:00+09:00", "2026-11-12T06:00:00+09:00"], ["1", "2"]);
  assert.deepEqual(s[0], { date: "2026-11-11", from: "18", to: null, value: "1" });
});

test("全部0%でも値をそのまま並べる（まとめ値や言葉に置き換えない）", () => {
  const r = extractForecast(jma0500(), opts);
  assert.ok(r.days[0].pops.every((p) => p.value === "0"));
  assert.equal(r.days[0].pops.length, 3);
  assert.equal(JSON.stringify(r).includes("雨の心配"), false);
});

test("空の降水確率は null（画面で「—（発表なし）」）", () => {
  const r = extractForecast(jma1700(), opts);
  assert.deepEqual(r.days[0].pops, [{ from: "18", to: "24", value: null }]);
});

test("今日の最低は、発表が同じ日の0時以降なら出さない。最高は発表のまま（11:00）", () => {
  const r = extractForecast(jma1100(), opts);
  assert.equal(r.days[0].tempMin, null);
  assert.equal(r.days[0].tempMax, "16");
  assert.equal(r.days[1].tempMin, "8");
  assert.equal(r.days[1].tempMax, "17");
});

test("05:00 発表でも、今日の最低の欄に値があっても出さない（時刻だけで決める）", () => {
  const r = extractForecast(jma0500(), opts);
  assert.equal(r.days[0].tempMin, null);
  assert.equal(r.days[0].tempMax, "15");
});

test("気温の欄は timeDefines の時刻で決まり、配列の順に依らない", () => {
  const defs = ["2026-11-12T09:00:00+09:00", "2026-11-12T00:00:00+09:00"];
  const m = tempsByDate(defs, ["20", "5"], "2026-11-11T17:00:00+09:00");
  assert.deepEqual(m.get("2026-11-12"), { min: "5", max: "20" });
});

test("値は比べない：明日の最低と最高が同じでも両方出す", () => {
  const m = tempsByDate(["2026-11-12T00:00:00+09:00", "2026-11-12T09:00:00+09:00"], ["12", "12"], "2026-11-11T11:00:00+09:00");
  assert.deepEqual(m.get("2026-11-12"), { min: "12", max: "12" });
});

test("17:00 発表（気温が2つ、降水確率が5つ）でも動く。発表のない項目は null", () => {
  const r = extractForecast(jma1700(), opts);
  assert.equal(r.days[0].tempMin, null);
  assert.equal(r.days[0].tempMax, null);
  assert.equal(r.days[1].tempMin, "8");
  assert.equal(r.days[1].tempMax, null); // 空文字 → 発表なし
});

test("気温の値は文字列のまま（数値に変えない）", () => {
  const b = jma1100();
  b[0].timeSeries[2].areas[0].temps = ["16", "16", "08", "17"];
  const r = extractForecast(b, opts);
  assert.equal(r.days[1].tempMin, "08");
});

test("地方と地点：設定に一致するものを出し、無ければ先頭を出して知らせる", () => {
  const r = extractForecast(jma1100(), { ...opts, areaName: "見本の島地方", tempPointName: "見本島" });
  assert.equal(r.areaName, "見本の島地方");
  assert.equal(r.days[0].weather, "島の見本");
  assert.equal(r.days[0].pops[0].value, "90");
  assert.equal(r.tempPointName, "見本島");
  const r2 = extractForecast(jma1100(), { ...opts, areaName: "無い地方", tempPointName: "無い地点" });
  assert.equal(r2.areaName, "東京地方");
  assert.equal(r2.notices.length, 2);
});

test("空白の整理だけ：連続した空白を1つに（全角は全角1つ）", () => {
  assert.equal(tidySpaces(" 晴れ　　のち  くもり "), "晴れ　のち くもり");
  assert.equal(tidySpaces("晴れ　夜　くもり"), "晴れ　夜　くもり");
});

test("今日・明日の語は作成日と一致するときだけ", () => {
  const r = extractForecast(jma1100(), { ...opts, today: "2026-11-10" });
  assert.deepEqual(r.days.map((d) => [d.date, d.label]), [["2026-11-11", "明日"], ["2026-11-12", null]]);
  const r2 = extractForecast(jma1100(), { ...opts, today: "2026-11-12" });
  assert.deepEqual(r2.days.map((d) => [d.date, d.label]), [["2026-11-12", "今日"], ["2026-11-13", "明日"]]);
});

test("形が違う JSON は例外", () => {
  assert.throws(() => extractForecast({}, opts));
  assert.throws(() => extractForecast([{ timeSeries: [] }], opts));
});
