// 天気のキャッシュのファイルの読み書き。壊れたファイルは無いものとして扱う。

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function writeJsonAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, file);
}

export const forecastCacheFile = (cacheDir, areaCode) => path.join(cacheDir, `weather-${areaCode}.json`);
export const areaCacheFile = (cacheDir) => path.join(cacheDir, "area.json");
// 気象庁へ送った取得の記録。地域を変えても数え直さないよう、地域ごとでなく1つにまとめる。
export const requestLogFile = (cacheDir) => path.join(cacheDir, "jma-requests.json");
