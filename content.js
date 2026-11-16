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

  const controller = ChatGPTImageCleanerController.createController({
    doc: document,
    dom: ChatGPTImageCleanerDOM,
    cleaner: ChatGPTImageCleaner,
    apiFactory: () => ChatGPTImageCleanerApi.createApiClient(),
    onProgress: broadcast
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.source !== "chatgpt-image-cleaner") return false;
    if (message.type === "scan" || message.type === "delete") {
      console.info(LOG_PREFIX, "开始", message.type, "（POST 资料库接口）");
      persistState({ command: message.type, phase: "started", error: null, startedAt: new Date().toISOString() });
    }
    controller.handle(message)
      .then((result) => {
        if (message.type === "status" && result && typeof result === "object") {
          result = { ...result, apiVersion: "2.4.4" };
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

  console.info(LOG_PREFIX, "内容脚本已加载 v2.4.4");
})();
