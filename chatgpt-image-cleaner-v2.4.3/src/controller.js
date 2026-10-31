(function installController(scope) {
  "use strict";

  function createController(options) {
    const {
      doc,
      dom,
      cleaner,
      apiFactory,
      onProgress = () => {}
    } = options;
    let activeController = null;
    let lastProgress = null;
    let lastTotal = null;

    function trackProgress(event) {
      lastProgress = event;
      onProgress(event);
    }

    async function handle(message = {}) {
      const onChatGPT = /(^|\.)chatgpt\.com$/i.test(doc?.location?.hostname || "");
      const onLibrary = Boolean(dom?.isLibraryPage?.(doc));
      if (message.type === "status") {
        return {
          chatgpt: onChatGPT,
          library: onLibrary,
          busy: Boolean(activeController),
          progress: lastProgress,
          total: lastTotal
        };
      }
      if (!onChatGPT) throw new Error("请先打开 chatgpt.com 页面");

      if (message.type === "cancel") {
        activeController?.abort();
        return { cancelled: Boolean(activeController) };
      }
      if (activeController) throw new Error("已有操作正在进行，请稍候或取消");

      const api = apiFactory();
      activeController = new AbortController();
      try {
        if (message.type === "scan") {
          const result = await cleaner.scanImages({
            api,
            signal: activeController.signal,
            onProgress: trackProgress
          });
          lastTotal = result.count;
          return result;
        }
        if (message.type === "delete") {
          return await cleaner.deleteAllImages({
            api,
            total: lastTotal,
            concurrency: message.concurrency,
            minAgeDays: message.minAgeDays,
            signal: activeController.signal,
            onProgress: trackProgress
          });
        }
        throw new Error("未知插件命令");
      } finally {
        activeController = null;
      }
    }

    return Object.freeze({ handle });
  }

  scope.ChatGPTImageCleanerController = Object.freeze({ createController });
})(globalThis);
