// 気象庁の予報 JSON の形を手で作った架空のデータ。天気の文は実在の発表と取り違えない「見本」の文。
// 形は 2026-11-11 11:00 発表の実物（東京 130000）で確かめた並びに合わせた。

const td = (d, h) => `2026-11-${d}T${String(h).padStart(2, "0")}:00:00+09:00`;

const weekly = { publishingOffice: "気象庁", reportDatetime: td(11, 11), timeSeries: [] };

function body({ report, wxDefines, popDefines, pops, tempDefines, temps, office = "気象庁" }) {
  return [
    {
      publishingOffice: office,
      reportDatetime: report,
      timeSeries: [
        {
          timeDefines: wxDefines,
          areas: [
            {
              area: { name: "東京地方", code: "130010" },
              weatherCodes: ["100", "200", "300"].slice(0, wxDefines.length),
              weathers: ["見本の天気　のち　見本", "見本　時々　見本の雨", "見本の晴れ"].slice(0, wxDefines.length),
              winds: ["見本の風", "見本の風", "見本の風"].slice(0, wxDefines.length),
            },
            {
              area: { name: "見本の島地方", code: "130020" },
              weatherCodes: ["100", "100", "100"].slice(0, wxDefines.length),
              weathers: ["島の見本", "島の見本", "島の見本"].slice(0, wxDefines.length),
            },
          ],
        },
        {
          timeDefines: popDefines,
          areas: [
            { area: { name: "東京地方", code: "130010" }, pops },
            { area: { name: "見本の島地方", code: "130020" }, pops: pops.map(() => "90") },
          ],
        },
        {
          timeDefines: tempDefines,
          areas: [
            { area: { name: "東京", code: "44132" }, temps },
            { area: { name: "見本島", code: "44172" }, temps: temps.map(() => "30") },
          ],
        },
      ],
    },
    weekly,
  ];
}

/** 11:00 発表の形：気温は [今日09, 今日00, 明日00, 明日09]、今日の2つの値が同じ。 */
export const jma1100 = () =>
  body({
    report: td(11, 11),
    wxDefines: [td(11, 11), td(12, 0), td(13, 0)],
    popDefines: [td(11, 12), td(11, 18), td(12, 0), td(12, 6), td(12, 12), td(12, 18)],
    pops: ["0", "10", "20", "30", "40", "50"],
    tempDefines: [td(11, 9), td(11, 0), td(12, 0), td(12, 9)],
    temps: ["16", "16", "8", "17"],
  });

/** 05:00 発表の形（架空）：今日の最低の欄に値が入っている場合。 */
export const jma0500 = () =>
  body({
    report: td(11, 5),
    wxDefines: [td(11, 5), td(12, 0), td(13, 0)],
    popDefines: [td(11, 6), td(11, 12), td(11, 18), td(12, 0), td(12, 6), td(12, 12), td(12, 18)],
    pops: ["0", "0", "0", "0", "0", "0", "0"],
    tempDefines: [td(11, 0), td(11, 9), td(12, 0), td(12, 9)],
    temps: ["7", "15", "8", "17"],
  });

/** 17:00 発表の形（架空）：気温は明日の2つだけ。数が違っても動くことの確認用。 */
export const jma1700 = () =>
  body({
    report: td(11, 17),
    wxDefines: [td(11, 17), td(12, 0), td(13, 0)],
    popDefines: [td(11, 18), td(12, 0), td(12, 6), td(12, 12), td(12, 18)],
    pops: ["", "20", "30", "40", "50"],
    tempDefines: [td(12, 0), td(12, 9)],
    temps: ["8", ""],
  });

/** area.json の形（offices だけ使う）。 */
export const areaJson = () => ({ centers: {}, offices: { "130000": { name: "東京都" }, "270000": { name: "大阪府" } }, class10s: {} });
