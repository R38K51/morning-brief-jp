#!/usr/bin/env node
// 入口：引数を読み、main を呼ぶ。既定の設定は、今いるフォルダではなくリポジトリ直下の config.json。

import { fileURLToPath } from "node:url";
import path from "node:path";
import { run } from "../src/main.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  let configPath = path.join(repoRoot, "config.json");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config" && argv[i + 1]) {
      configPath = path.resolve(argv[i + 1]);
      i++;
    }
  }
  return { configPath };
}

const { configPath } = parseArgs(process.argv.slice(2));
try {
  const { exitCode } = await run({ configPath });
  process.exitCode = exitCode;
} catch {
  console.log("朝のまとめを作れませんでした。");
  process.exitCode = 1;
}
