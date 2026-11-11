// 初版に入れないものがコードに無いこと（要約、子プロセス、天気を Claude に渡す処理）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function sources(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sources(p)));
    else if (/\.(mjs|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("claude を呼ぶ処理と子プロセスが src と bin に無い（天気は要約の入力に入らない）", async () => {
  const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const files = [...(await sources(path.join(root, "src"))), ...(await sources(path.join(root, "bin")))];
  assert.ok(files.length > 5);
  for (const f of files) {
    const s = await readFile(f, "utf8");
    assert.doesNotMatch(s, /child_process|execFile|spawn\(|claude\s+-p|ollama/i, f);
  }
});
