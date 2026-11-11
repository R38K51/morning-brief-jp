// 引数の読み方。通信もファイルの読み書きもしない（--help と引数の誤りでは取得しないため、main より前に決める）。

import path from "node:path";

export const USAGE = `使い方：node bin/morning-brief.mjs [--config <設定ファイルのパス>]

  --config <パス>  設定ファイルを指定します（既定：リポジトリ直下の config.json）
  --help           この使い方を出して終わります（取得はしません）`;

export const CLI_MESSAGES = {
  unknown: (arg) => `知らない引数です：${arg}`,
  configNoValue: "--config の後に設定ファイルのパスを書いてください。",
  seeHelp: "使い方は --help で確かめてください。",
};

/**
 * @returns { kind: "run", configPath } | { kind: "help" } | { kind: "error", message }
 */
export function parseArgs(argv, defaultConfigPath) {
  let configPath = defaultConfigPath;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help") return { kind: "help" };
    if (a === "--config") {
      const v = argv[i + 1];
      if (v === undefined || v === "" || v.startsWith("--")) return { kind: "error", message: CLI_MESSAGES.configNoValue };
      configPath = path.resolve(v);
      i++;
      continue;
    }
    return { kind: "error", message: CLI_MESSAGES.unknown(a) };
  }
  return { kind: "run", configPath };
}
