// 运行在页面主世界（MAIN world）：只读观察页面自身的资料库列表请求，
// 把真实的列表接口 URL 和数据样例转发给内容脚本，供插件复用。
(function hookLibraryRequests() {
  "use strict";
  if (window.__cgptImageCleanerHooked) return;
  window.__cgptImageCleanerHooked = true;

  const LIST_PATTERN = /\/backend-api\/[^\s"']*(library|image_gen|files)[^\s"']*/i;

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    const response = await originalFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : String(input?.url || "");
      const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
      if (method === "GET" && LIST_PATTERN.test(url)) {
        const clone = response.clone();
        clone.json().then((data) => {
          const items = data?.items || data?.files || data?.data || data?.results;
          if (!Array.isArray(items)) return;
          window.postMessage({
            source: "chatgpt-image-cleaner-hook",
            url,
            itemCount: items.length,
            sample: items[0] ?? null,
            cursorKeys: Object.keys(data || {}).filter((key) => /cursor|after|next|offset/i.test(key))
          }, window.location.origin);
        }).catch(() => {});
      }
    } catch (_) { /* 观察失败不影响页面 */ }
    return response;
  };
})();
