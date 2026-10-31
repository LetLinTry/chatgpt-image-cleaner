(function bootstrapPopup() {
  "use strict";

  const ui = {
    status: document.querySelector("#status"), detail: document.querySelector("#detail"),
    dot: document.querySelector("#dot"), meter: document.querySelector("#meter-bar"),
    open: document.querySelector("#open-library"), scan: document.querySelector("#scan"),
    dangerZone: document.querySelector("#danger-zone"),
    age: document.querySelector("#age"), threads: document.querySelector("#threads"),
    delete: document.querySelector("#delete"), cancel: document.querySelector("#cancel")
  };
  let tabId = null;
  let busy = false;

  function setStatus(title, detail, type = "", progress = 0) {
    ui.status.textContent = title;
    ui.detail.textContent = detail;
    ui.dot.className = `dot ${type}`;
    ui.meter.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }

  function setBusyView(isBusy) {
    busy = isBusy;
    ui.delete.disabled = isBusy;
    ui.scan.disabled = isBusy;
    ui.age.disabled = isBusy;
    ui.threads.disabled = isBusy;
    ui.cancel.hidden = !isBusy;
  }

  async function loadSettings() {
    try {
      const { settings } = await chrome.storage.local.get("settings");
      if (settings?.minAgeDays !== undefined) ui.age.value = String(settings.minAgeDays);
      if (settings?.concurrency !== undefined) ui.threads.value = String(settings.concurrency);
    } catch (_) { /* 忽略 */ }
  }

  function saveSettings() {
    try {
      chrome.storage.local.set({
        settings: { minAgeDays: Number(ui.age.value), concurrency: Number(ui.threads.value) }
      }).catch(() => {});
    } catch (_) { /* 忽略 */ }
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/chatgpt\.com\//i.test(tab.url || "")) return null;
    return tab;
  }

  async function send(message) {
    if (!tabId) throw new Error("未找到 ChatGPT 页面");
    const response = await chrome.tabs.sendMessage(tabId, { source: "chatgpt-image-cleaner", ...message });
    if (!response?.ok) throw new Error(response?.error || "页面没有响应，请刷新 ChatGPT 后重试");
    return response.result;
  }

  async function showLastRunIfInteresting() {
    try {
      const { lastRun } = await chrome.storage.local.get("lastRun");
      if (lastRun?.error) {
        setStatus("上次运行已停止", `${lastRun.error}（${lastRun.updatedAt || ""}）`, "error");
        return true;
      }
    } catch (_) { /* 忽略 */ }
    return false;
  }

  async function initialize() {
    await loadSettings();
    const tab = await activeTab();
    if (!tab) {
      setStatus("未打开 ChatGPT", "点击下方按钮打开资料库。", "error");
      return;
    }
    tabId = tab.id;
    try {
      const state = await send({ type: "status" });
      if (!state.chatgpt) throw new Error("当前不是 chatgpt.com 页面");
      ui.open.hidden = true;
      ui.dangerZone.hidden = false;
      if (state.busy) {
        setBusyView(true);
        const event = state.progress || {};
        setStatus(
          "正在删除…（后台运行中）",
          ChatGPTImageCleanerPopup.formatDeleteProgress(event),
          "",
          ChatGPTImageCleanerPopup.progressPercent(event)
        );
        return;
      }
      const showedError = await showLastRunIfInteresting();
      if (!showedError) {
        setStatus("已连接 ChatGPT", "选择范围和线程数，点击开始删除。", "ok", 5);
      }
    } catch (error) {
      setStatus("无法连接页面", `${error.message}`, "error");
    }
  }

  ui.open.addEventListener("click", () => chrome.tabs.create({ url: "https://chatgpt.com/library" }));
  ui.age.addEventListener("change", saveSettings);
  ui.threads.addEventListener("change", saveSettings);

  ui.scan.addEventListener("click", async () => {
    setBusyView(true);
    setStatus("正在统计图片总数…", "通过 ChatGPT 接口分页统计。", "", 25);
    try {
      const result = await send({ type: "scan" });
      setStatus("统计完成", ChatGPTImageCleanerPopup.formatScanResult(result), "ok", 100);
    } catch (error) {
      setStatus("统计停止", error.message, "error");
    } finally {
      setBusyView(false);
    }
  });

  ui.delete.addEventListener("click", async () => {
    saveSettings();
    setBusyView(true);
    setStatus("正在删除…", "边抓取边删除，关闭本弹窗不影响进度，但请保持标签页打开。", "", 5);
    try {
      const result = await send({
        type: "delete",
        concurrency: Number(ui.threads.value),
        minAgeDays: Number(ui.age.value)
      });
      const failedNote = result.failed > 0 ? `，${result.failed} 张失败已跳过` : "";
      setStatus("删除完成", `已删除 ${result.deleted} 张图片${failedNote}。`, "ok", 100);
    } catch (error) {
      setStatus("操作已停止", error.message, "error");
    } finally {
      setBusyView(false);
    }
  });

  ui.cancel.addEventListener("click", async () => {
    try { await send({ type: "cancel" }); } catch (_) { /* 页面可能刚好完成 */ }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.source !== "chatgpt-image-cleaner" || message.type !== "progress") return;
    const event = message.event || {};
    if (event.phase === "scanning") {
      setStatus("正在统计图片总数…", `已统计 ${event.total || 0} 张。`, "", 50);
    }
    if (event.phase === "progress") {
      setStatus(
        "正在删除…",
        ChatGPTImageCleanerPopup.formatDeleteProgress(event),
        "",
        ChatGPTImageCleanerPopup.progressPercent(event)
      );
    }
    if (event.phase === "complete") {
      const failedNote = event.failed > 0 ? `，${event.failed} 张失败已跳过` : "";
      setStatus("删除完成", `已删除 ${event.deleted || 0} 张图片${failedNote}。`, "ok", 100);
      setBusyView(false);
    }
    if (event.phase === "stopped" && event.error) {
      setStatus("操作已停止", event.error, "error");
      setBusyView(false);
    }
  });
  initialize();
})();
