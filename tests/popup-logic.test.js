import test from "node:test";
import assert from "node:assert/strict";

async function loadPopupLogic() {
  await import("../src/popup-logic.js").catch(() => {});
  return globalThis.ChatGPTImageCleanerPopup || {};
}

test("formats scan results with a real total", async () => {
  const { formatScanResult } = await loadPopupLogic();
  assert.equal(typeof formatScanResult, "function");
  assert.match(formatScanResult({ count: 12345, complete: true }), /共发现 12345 张/);
  assert.match(formatScanResult({ count: 500, complete: false }), /至少 500 张/);
  assert.match(formatScanResult({ count: 0, complete: true }), /没有发现图片/);
});

test("formats delete progress with totals and skipped failures", async () => {
  const { formatDeleteProgress, progressPercent } = await loadPopupLogic();
  assert.match(formatDeleteProgress({ deleted: 30, total: 100 }), /已删除 30 \/ 100 张/);
  assert.match(formatDeleteProgress({ deleted: 30, failed: 2 }), /2 张失败已跳过/);
  assert.equal(progressPercent({ deleted: 50, total: 100 }), 50);
  assert.equal(progressPercent({ deleted: 0, total: 0 }), 50);
  assert.equal(progressPercent({ deleted: 100, total: 100 }), 99);
});
