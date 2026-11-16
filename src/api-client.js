(function installApiClient(scope) {
  "use strict";

  const BASE = "https://chatgpt.com";
  // 请求结构来自 2026-11-12 网页实际请求；读取上传和生成图片，客户端过滤非图片。
  const LIST_BODY = Object.freeze({
    cursor: null, limit: 50, categories: [], source: null,
    include_hidden_files: false, include_pages: false,
    defer_page_sharing_badges: true, defer_sharing_badges: true,
    exclude_saved_responses: true, exclude_space_roots: true,
    exclude_embedded_artifacts: true, include_uploaded_files: true,
    include_imagegen_files: true, include_saved_entities: false,
    include_sites: false, ranking: "suggested", providers: []
  });

  function libraryFileId(item) {
    const id = item?.library_file_id || item?.id;
    return typeof id === "string" && /^libfile_[A-Za-z0-9_-]+$/.test(id) ? id : null;
  }
  function fileId(item) {
    const id = item?.file_id;
    return typeof id === "string" && /^file[_-][A-Za-z0-9_-]+$/.test(id) ? id : null;
  }
  function parentDirectoryId(item) { return item?.parent_directory_id ?? item?.directory_id ?? null; }
  function fileName(item) { return typeof item?.file_name === "string" ? item.file_name : null; }
  function imageId(item) { return libraryFileId(item); }
  function looksLikeImage(item) {
    if (item?.trashed_at) return false;
    const mime = String(item?.mime_type || "").toLowerCase();
    if (mime) return mime.startsWith("image/");
    if (item?.library_file_category) return item.library_file_category === "image";
    return /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(fileName(item) || "");
  }

  function createApiClient(options = {}) {
    const fetchImpl = options.fetch || scope.fetch.bind(scope);
    const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const maxRetries = options.maxRetries ?? 5;
    let accessToken = options.accessToken || null;

    async function request(path, body) {
      let refreshed = false;
      for (let attempt = 0; ; attempt += 1) {
        if (!accessToken) {
          const sessionResponse = await fetchImpl(`${BASE}/api/auth/session`, { credentials: "include" });
          if (!sessionResponse.ok) throw new Error(`无法获取登录会话（HTTP ${sessionResponse.status}），请先登录 ChatGPT`);
          accessToken = (await sessionResponse.json())?.accessToken;
          if (!accessToken) throw new Error("未登录 ChatGPT，请先登录后重试");
        }
        let response;
        try {
          response = await fetchImpl(`${BASE}${path}`, {
            method: "POST", credentials: "include",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
        } catch (error) {
          if (attempt >= maxRetries) throw error;
          await wait(Math.min(30000, 1000 * 2 ** attempt));
          continue;
        }
        if (response.status === 401) {
          if (refreshed) throw new Error("登录会话已失效，请先登录 ChatGPT 后重试");
          accessToken = null;
          refreshed = true;
          continue;
        }
        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          const retryAfter = Number(response.headers?.get?.("retry-after"));
          await wait(retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 1000 * 2 ** attempt));
          continue;
        }
        return response;
      }
    }

    async function listImages({ limit = 50, after = null } = {}) {
      const response = await request("/backend-api/files/library", {
        ...LIST_BODY, limit: Math.max(1, Math.min(50, Math.floor(Number(limit)) || 50)), cursor: after
      });
      if (!response.ok) throw new Error(`读取文件列表失败（HTTP ${response.status}）`);
      const data = await response.json().catch(() => null);
      if (!Array.isArray(data?.items) || (data.cursor != null && typeof data.cursor !== "string")) {
        throw new Error("文件列表响应格式已变化，已停止");
      }
      return { items: data.items.filter((item) => libraryFileId(item) && looksLikeImage(item)), cursor: data.cursor || null };
    }

    async function deleteImage(item) {
      const libId = libraryFileId(item);
      const underlying = fileId(item);
      const directory = parentDirectoryId(item);
      const name = fileName(item);
      const missing = [];
      if (!looksLikeImage(item)) missing.push("图片类型");
      if (!libId) missing.push("library_file_id");
      if (!underlying) missing.push("file_id");
      if (!name) missing.push("file_name");
      if (typeof directory !== "string" || !/^libdir_[A-Za-z0-9_-]+$/.test(directory)) missing.push("parent_directory_id");
      if (!looksLikeImage(item) || !libId || !underlying || !name ||
          typeof directory !== "string" || !/^libdir_[A-Za-z0-9_-]+$/.test(directory)) {
        return { ok: false, status: `缺少有效字段：${missing.join("、")}` };
      }
      // HTTP 200 也可能包含单文件的失败码。
      for (let attempt = 0; ; attempt += 1) {
        const response = await request("/backend-api/files/library/files/delete-batch", {
          files: [{ library_file_id: libId, file_id: underlying, parent_directory_id: directory, file_name: name }]
        });
        if (!response.ok) return { ok: false, status: `HTTP ${response.status}` };
        const data = await response.json().catch(() => null);
        const result = Array.isArray(data?.files) ? data.files.find((file) => file.library_file_id === libId) : null;
        if (response.ok && data?.success === true && result?.success === true && result?.status_code === 200) return { ok: true };
        const status = response.ok ? result?.status_code : response.status;
        if ((status === 429 || status >= 500) && attempt < maxRetries) {
          await wait(Math.min(30000, 1000 * 2 ** attempt));
          continue;
        }
        return { ok: false, status: status ? `单文件 HTTP ${status}` : "删除响应未确认成功" };
      }
    }
    return Object.freeze({ listImages, deleteImage, imageId, describe: () => "POST /backend-api/files/library" });
  }

  scope.ChatGPTImageCleanerApi = Object.freeze({
    createApiClient, imageId, looksLikeImage, libraryFileId, fileId, parentDirectoryId, fileName
  });
})(globalThis);
