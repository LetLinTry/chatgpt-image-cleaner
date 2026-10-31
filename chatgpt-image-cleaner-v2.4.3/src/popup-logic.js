(function installPopupLogic(scope) {
  "use strict";

  function formatScanResult(result) {
    const count = Number(result?.count) || 0;
    if (count === 0) return "资料库中没有发现图片";
    return result?.complete === false
      ? `发现至少 ${count} 张图片（扫描已达安全上限）`
      : `共发现 ${count} 张图片`;
  }

  function formatDeleteProgress(event) {
    const deleted = Number(event?.deleted) || 0;
    const failed = Number(event?.failed) || 0;
    const total = Number(event?.total) || 0;
    const parts = [total > 0 ? `已删除 ${deleted} / ${total} 张` : `已删除 ${deleted} 张`];
    if (failed > 0) parts.push(`${failed} 张失败已跳过`);
    return parts.join("，");
  }

  function progressPercent(event) {
    const deleted = Number(event?.deleted) || 0;
    const total = Number(event?.total) || 0;
    if (total <= 0) return 50;
    return Math.max(5, Math.min(99, Math.round((deleted / total) * 100)));
  }

  scope.ChatGPTImageCleanerPopup = Object.freeze({
    formatScanResult,
    formatDeleteProgress,
    progressPercent
  });
})(globalThis);
