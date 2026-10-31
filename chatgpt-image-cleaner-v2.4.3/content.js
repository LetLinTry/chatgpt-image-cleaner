(function bootstrapContentScript() {
  "use strict";

  const LOG_PREFIX = "[图片清理器]";

  function persistState(patch) {
    try {
      chrome.storage?.local?.get("lastRun").then((data) => {
        const lastRun = { ...(data?.lastRun || {}), ...patch, updatedAt: new Date().toISOString() };
        return chrome.storage.local.set({ lastRun });
      }).catch(() => {});
    } catch (_) { /* storage 不可用时忽略 */ }
  }

  let lastSentAt = 0;
  let progressCount = 0;
  function broadcast(event) {
    const now = Date.now();
    const important = event.phase !== "progress";
    progressCount += 1;
    if (important || progressCount % 20 === 0) {
      console.info(LOG_PREFIX, event.phase, JSON.stringify(event));
    }
    if (important || now - lastSentAt >= 300) {
      lastSentAt = now;
      persistState(event);
      chrome.runtime.sendMessage({ source: "chatgpt-image-cleaner", type: "progress", event }).catch(() => {});
    }
  }

  // 接收 page-hook（主世界）捕获的页面真实列表接口
  let bestCapture = null;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.source !== "chatgpt-image-cleaner-hook" || !data.url) return;
    const isLibraryShaped = JSON.stringify(data.sample || {}).includes("libfile");
    const currentIsLibraryShaped = bestCapture && JSON.stringify(bestCapture.sample || {}).includes("libfile");
    // 优先保留带 libfile 条目的捕获（文件库接口），其次保留最新的非空捕获
    if (!bestCapture || isLibraryShaped || (!currentIsLibraryShaped && data.itemCount > 0)) {
      bestCapture = { url: data.url, sample: data.sample };
      console.info(LOG_PREFIX, "已捕获页面列表接口:", data.url.split("?")[0], `(${data.itemCount} 项)`);
    }
  });

  const controller = ChatGPTImageCleanerController.createController({
    doc: document,
    dom: ChatGPTImageCleanerDOM,
    cleaner: ChatGPTImageCleaner,
    apiFactory: () => ChatGPTImageCleanerApi.createApiClient({ capturedList: bestCapture }),
    onProgress: broadcast
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.source !== "chatgpt-image-cleaner") return false;
    if (message.type === "scan" || message.type === "delete") {
      console.info(LOG_PREFIX, "开始", message.type, bestCapture ? `（已捕获接口: ${bestCapture.url.split("?")[0]}）` : "（未捕获页面接口，将使用候选探测）");
      persistState({ command: message.type, phase: "started", error: null, startedAt: new Date().toISOString() });
    }
    controller.handle(message)
      .then((result) => {
        if (message.type === "status" && result && typeof result === "object") {
          result = { ...result, capturedList: Boolean(bestCapture) };
        }
        sendResponse({ ok: true, result });
      })
      .catch((error) => {
        const text = error?.message || "操作失败";
        console.error(LOG_PREFIX, "已停止:", text);
        broadcast({ phase: "stopped", error: text });
        sendResponse({ ok: false, error: text });
      });
    return true;
  });

  console.info(LOG_PREFIX, "内容脚本已加载 v2.4.3");
})();
