// HTML のエスケープと、リンクに使ってよい URL の検査。

const MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** 画面に出す文字をエスケープする（本文にも属性値にも使える）。 */
export function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => MAP[c]);
}

/** http: と https: の URL だけを返す。それ以外（javascript: など）は null。 */
export function safeHttpUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.href;
}
