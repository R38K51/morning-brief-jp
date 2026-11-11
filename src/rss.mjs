// RSS 2.0 / RSS 1.0 / Atom の読み取りと、前日 sinceHour 時以降の絞り込み。
// 見出しは加工しない。本文（content）は取らない。説明は100字（書記素）で区切る。

import { XMLParser } from "fast-xml-parser";
import { safeHttpUrl } from "./escape.mjs";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ["item", "entry"].includes(name),
});

export const DESCRIPTION_MAX = 100;

function text(node) {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === "object" && "#text" in node) return text(node["#text"]);
  return "";
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** 説明の HTML を文字にする：タグを除き、よくある文字参照を戻し、空白をまとめる。 */
export function plainText(s) {
  return String(s ?? "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent) => {
      if (ent[0] === "#") {
        const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        try {
          return String.fromCodePoint(code);
        } catch {
          return m;
        }
      }
      return NAMED[ent.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

/** 書記素で max 字までにし、切ったときだけ末尾に … を付ける。 */
export function truncate(s, max = DESCRIPTION_MAX) {
  const chars = Array.from(segmenter.segment(s), (x) => x.segment);
  if (chars.length <= max) return s;
  return chars.slice(0, max).join("") + "…";
}

function atomLink(link) {
  const links = Array.isArray(link) ? link : link ? [link] : [];
  for (const l of links) {
    if (typeof l === "string") return l;
    const rel = l?.["@_rel"];
    if (!rel || rel === "alternate") return l?.["@_href"] ?? text(l);
  }
  return "";
}

function parseDate(...candidates) {
  for (const c of candidates) {
    const s = text(c).trim();
    if (!s) continue;
    const t = Date.parse(s);
    if (Number.isFinite(t)) return new Date(t);
  }
  return null;
}

/** XML の文字列 → 記事の配列（絞り込み前）。壊れた XML や形の違うものは例外。 */
export function parseFeed(xml) {
  const doc = parser.parse(xml, true);
  let entries;
  let atom = false;
  if (doc?.rss?.channel) entries = doc.rss.channel.item ?? [];
  else if (doc?.RDF) entries = doc.RDF.item ?? [];
  else if (doc?.feed) {
    entries = doc.feed.entry ?? [];
    atom = true;
  } else throw new Error("not a feed");

  return entries.map((e) => {
    const title = text(e.title).trim();
    const rawLink = atom ? atomLink(e.link) : text(e.link).trim() || (e.guid?.["@_isPermaLink"] !== "false" ? text(e.guid).trim() : "");
    const publishedAt = parseDate(e.pubDate, e.date, e.published, e.updated);
    const desc = plainText(text(e.description) || text(e.summary));
    return {
      title,
      link: safeHttpUrl(rawLink),
      publishedAt,
      description: desc ? truncate(desc) : "",
    };
  });
}

/** 前日 since 以降の、時刻と見出しのある記事だけ。新しい順に max 件。 */
export function selectItems(items, since, max) {
  return items
    .filter((i) => i.title && i.publishedAt && i.publishedAt.getTime() > since.getTime())
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, max);
}
