// CLI のテスト用：node --import で先に読み込み、fetch を差し替える（本物の通信をさせない）。
// 呼ばれたら標準エラーに印を出して失敗させる。
globalThis.fetch = async () => {
  process.stderr.write("NETWORK-CALLED\n");
  throw new TypeError("fetch failed");
};
