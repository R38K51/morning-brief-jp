#!/usr/bin/env node
// 入口：引数を読み、main を呼ぶ。既定の設定は、今いるフォルダではなくリポジトリ直下の config.json。
// --help と引数の誤りでは main を呼ばない（取得しない）。

import { fileURLToPath } from "node:url";
import path from "node:path";
import { CLI_MESSAGES, parseArgs, USAGE } from "../src/cli.mjs";
import { run } from "../src/main.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = parseArgs(process.argv.slice(2), path.join(repoRoot, "config.json"));
if (args.kind === "help") {
  console.log(USAGE);
  process.exitCode = 0;
} else if (args.kind === "error") {
  console.log(args.message);
  console.log(CLI_MESSAGES.seeHelp);
  process.exitCode = 1;
} else {
  try {
    const { exitCode } = await run({ configPath: args.configPath });
    process.exitCode = exitCode;
  } catch {
    console.log("朝のまとめを作れませんでした。");
    process.exitCode = 1;
  }
}
