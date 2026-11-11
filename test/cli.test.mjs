import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLI_MESSAGES, parseArgs, USAGE } from "../src/cli.mjs";
import { tempDir, writeConfig } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(root, "bin", "morning-brief.mjs");
const NO_NET = pathToFileURL(path.join(root, "test", "fixtures", "no-network.mjs")).href;

/** CLI を子プロセスで動かす。fetch は差し替え（呼ばれたら stderr に印）。 */
function cli(args, cwd) {
  const r = spawnSync(process.execPath, ["--import", NO_NET, BIN, ...args], { cwd: cwd ?? root, encoding: "utf8", timeout: 30_000 });
  return { code: r.status, out: r.stdout.replace(/\r\n/g, "\n"), err: r.stderr };
}

test("parseArgs：--help、--config、未知の引数、--config の値なし", () => {
  assert.deepEqual(parseArgs([], "/d/config.json"), { kind: "run", configPath: "/d/config.json" });
  assert.deepEqual(parseArgs(["--help"], "/d"), { kind: "help" });
  assert.deepEqual(parseArgs(["--config", "x.json", "--help"], "/d"), { kind: "help" });
  assert.equal(parseArgs(["--config", "x.json"], "/d").configPath, path.resolve("x.json"));
  assert.deepEqual(parseArgs(["--hepl"], "/d"), { kind: "error", message: CLI_MESSAGES.unknown("--hepl") });
  assert.deepEqual(parseArgs(["extra"], "/d"), { kind: "error", message: CLI_MESSAGES.unknown("extra") });
  assert.deepEqual(parseArgs(["--config"], "/d"), { kind: "error", message: CLI_MESSAGES.configNoValue });
  assert.deepEqual(parseArgs(["--config", "--help"], "/d"), { kind: "error", message: CLI_MESSAGES.configNoValue });
});

test("CLI：--help は使い方を出して終了コード 0。取得しない", () => {
  const r = cli(["--help"]);
  assert.equal(r.code, 0);
  assert.equal(r.out, `${USAGE}\n`);
  assert.equal(r.err.includes("NETWORK-CALLED"), false);
});

test("CLI：--config と一緒の --help でも取得しない（テスト担当の事故の再現）", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const file = await writeConfig(d.dir, { weather: { areaCode: "130000" } });
  const r = cli(["--config", file, "--help"], d.dir);
  assert.equal(r.code, 0);
  assert.equal(r.err.includes("NETWORK-CALLED"), false);
});

test("CLI：未知の引数は「知らない引数です」と出して終了コード 1。取得しない", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const file = await writeConfig(d.dir, { weather: { areaCode: "130000" } });
  const r = cli(["--config", file, "--verbose"], d.dir);
  assert.equal(r.code, 1);
  assert.equal(r.out, "知らない引数です：--verbose\n使い方は --help で確かめてください。\n");
  assert.equal(r.err.includes("NETWORK-CALLED"), false);
});

test("CLI：設定の誤りは終了コード 1（取得しない）", async (t) => {
  const d = await tempDir();
  t.after(d.cleanup);
  const r = cli(["--config", path.join(d.dir, "config.json")], d.dir);
  assert.equal(r.code, 1);
  assert.equal(r.out, "config.json が見つかりません。config.example.json を config.json という名前でコピーしてください。\n");
  assert.equal(r.err.includes("NETWORK-CALLED"), false);
});
