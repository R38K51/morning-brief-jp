// テストの共通部品：差し替えの fetch、一時フォルダ、HTML から文字を取り出す関数。

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * routes: { [url]: Array<handler> | handler }
 * handler: { status, body, headers } | Error | (url, init) => Response
 * 配列なら呼ばれるたびに先頭から順に使う（最後のものは使い回す）。
 */
export function fakeFetch(routes) {
  const calls = [];
  const counters = new Map();
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    let r = routes[String(url)];
    if (r === undefined) throw new TypeError("fetch failed");
    if (Array.isArray(r)) {
      const i = counters.get(url) ?? 0;
      counters.set(url, i + 1);
      r = r[Math.min(i, r.length - 1)];
    }
    if (typeof r === "function") return r(url, init);
    if (r instanceof Error) throw r;
    const body = typeof r.body === "string" || r.body instanceof Uint8Array ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  fn.calls = calls;
  return fn;
}

export function recordingSleep() {
  const waits = [];
  const fn = async (ms) => {
    waits.push(ms);
  };
  fn.waits = waits;
  return fn;
}

export async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mbj-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function writeConfig(dir, obj) {
  const file = path.join(dir, "config.json");
  await writeFile(file, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2), "utf8");
  return file;
}

/** HTML のタグを除き、文字参照を戻した文字（段落ごとに改行）。 */
export function htmlText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<\/(p|h[1-6]|li|dt|dd|div|section|summary)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 段落（<p>…</p>）ごとの文字の配列。 */
export function paragraphs(html) {
  return [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => htmlText(m[1]).trim());
}

export const JST = (s) => new Date(`${s}+09:00`);
