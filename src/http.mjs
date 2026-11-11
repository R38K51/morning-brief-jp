// 取得の共通部品：User-Agent、1回ごとのタイムアウト、再試行、応答の大きさの上限。
// エラーの文に URL を入れない（iCal の URL は秘密のため）。

import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const VERSION = pkg.version;
export const USER_AGENT = `morning-brief-jp/${pkg.version} (+https://github.com/R38K51/morning-brief-jp)`;
export const TIMEOUT_MS = 10_000;
export const MAX_BYTES = 5 * 1024 * 1024;

export class FetchError extends Error {
  /** kind: "network" | "timeout" | "http" | "too-large" */
  constructor(kind, status = null) {
    super(kind === "http" ? `HTTP ${status}` : kind);
    this.name = "FetchError";
    this.kind = kind;
    this.status = status;
  }
}

function isRetryable(err) {
  if (!(err instanceof FetchError)) return true;
  if (err.kind === "network" || err.kind === "timeout") return true;
  if (err.kind === "http") return err.status === 429 || (err.status >= 500 && err.status <= 599);
  return false;
}

export const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readLimited(response, maxBytes) {
  const len = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(len) && len > maxBytes) throw new FetchError("too-large");
  if (!response.body || typeof response.body.getReader !== "function") {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new FetchError("too-large");
    return buf;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* 打ち切るだけ */
      }
      throw new FetchError("too-large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function once(url, { fetchImpl, timeoutMs, maxBytes, userAgent }) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { "User-Agent": userAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = e?.name ?? "";
    if (name === "TimeoutError" || name === "AbortError") throw new FetchError("timeout");
    throw new FetchError("network");
  }
  if (!response.ok) throw new FetchError("http", response.status);
  try {
    const bytes = await readLimited(response, maxBytes);
    return { status: response.status, bytes, contentType: response.headers?.get?.("content-type") ?? "" };
  } catch (e) {
    if (e instanceof FetchError) throw e;
    const name = e?.name ?? "";
    if (name === "TimeoutError" || name === "AbortError") throw new FetchError("timeout");
    throw new FetchError("network");
  }
}

/**
 * URL を取得してバイト列を返す。
 * onAttempt は実際に送る直前に毎回呼ばれる（気象庁への回数の記録に使う）。
 */
export async function fetchBytes(url, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    sleep = realSleep,
    retries = 1,
    retryDelayMs = 5_000,
    timeoutMs = TIMEOUT_MS,
    maxBytes = MAX_BYTES,
    userAgent = USER_AGENT,
    onAttempt = async () => {},
  } = opts;
  const attempts = 1 + Math.max(0, Math.min(1, retries));
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(retryDelayMs);
    await onAttempt(i);
    try {
      return await once(url, { fetchImpl, timeoutMs, maxBytes, userAgent });
    } catch (e) {
      lastErr = e instanceof FetchError ? e : new FetchError("network");
      if (!isRetryable(lastErr)) break;
    }
  }
  throw lastErr;
}

/** charset を決めて文字列にする（Content-Type → XML 宣言 → UTF-8）。 */
export function decodeBytes(bytes, contentType = "") {
  let label = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType)?.[1];
  if (!label) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 300));
    label = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1];
  }
  let decoder;
  try {
    decoder = new TextDecoder(label || "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(bytes);
}

export async function fetchText(url, opts = {}) {
  const r = await fetchBytes(url, opts);
  return { status: r.status, text: decodeBytes(r.bytes, r.contentType) };
}
