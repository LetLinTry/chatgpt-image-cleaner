(function installApiClient(scope) {
  "use strict";

  const BASE = "https://chatgpt.com";

  // 依次探测的列表接口；第一个返回文件数组的胜出。
  // nodes 是资料库页面实际使用的接口（categories=image 服务端只返回图片）。
  const LIST_CANDIDATES = [
    { path: "/backend-api/files/library/nodes", params: { categories: "image" }, kind: "library", trust: true },
    { path: "/backend-api/files/library/files", kind: "library" },
    { path: "/backend-api/files/library", kind: "library" },
    { path: "/backend-api/my/recent/image_gen", kind: "image_gen" }
  ];

  const IMAGE_EXTENSION = /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i;

  function defaultWait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function firstMatch(fields, pattern) {
    for (const field of fields) {
      const matches = String(field || "").match(pattern);
      if (matches) return matches[matches.length - 1];
    }
    return null;
  }

  // 节点结构未知时的兜底：在整个条目的 JSON 里找长 ID。
  // 长度门槛（16+）避免误匹配 "libfile_id" 这类字段名。
  function deepMatch(item, pattern) {
    try {
      const matches = JSON.stringify(item).match(pattern);
      return matches ? matches[0] : null;
    } catch (_) {
      return null;
    }
  }

  function libraryFileId(item) {
    return firstMatch([item?.id, item?.library_file_id, item?.libfile_id], /libfile_[A-Za-z0-9_-]+/g)
      || deepMatch(item, /libfile_[A-Za-z0-9-]{16,}/);
  }

  function fileId(item) {
    return firstMatch(
      [item?.file_id, item?.file?.id, item?.id, item?.asset_pointer, item?.generation_id],
      /file[-_][A-Za-z0-9_-]+/g
    ) || deepMatch(item, /(?<!lib)file[-_][A-Za-z0-9-]{16,}/);
  }

  function imageId(item) {
    const id = libraryFileId(item) || fileId(item);
    if (id) return id;
    return typeof item?.id === "string" && item.id ? item.id : null;
  }

  function fileName(item) {
    const value = item?.file_name || item?.name || item?.title;
    return typeof value === "string" && value ? value : null;
  }

  function parentDirectoryId(item) {
    return firstMatch(
      [item?.parent_directory_id, item?.directory_id, item?.parent_id, item?.directory?.id],
      /libdir_[A-Za-z0-9_-]+/g
    ) || deepMatch(item, /libdir_[A-Za-z0-9-]{16,}/);
  }

  function looksLikeImage(item) {
    const mime = String(item?.mime_type || item?.mimeType || item?.content_type || "").toLowerCase();
    if (mime.startsWith("image/")) return true;
    if (mime) return false;
    const name = fileName(item);
    if (name && IMAGE_EXTENSION.test(name)) return true;
    const kind = String(item?.file_type || item?.type || item?.category || item?.kind || "").toLowerCase();
    return /image|photo/.test(kind);
  }

  function extractItems(data) {
    for (const key of ["items", "nodes", "files", "data", "results"]) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    return null;
  }

  function extractCursor(data) {
    const cursor = data?.cursor ?? data?.next_cursor ?? data?.after ?? data?.next ?? null;
    return typeof cursor === "string" && cursor ? cursor : null;
  }

  function hasTypeEvidence(item) {
    return [
      item?.mime_type, item?.mimeType, item?.content_type,
      item?.file_name, item?.name,
      item?.file_type, item?.category, item?.kind
    ].some((value) => value !== undefined && value !== null && value !== "");
  }

  // 有类型信息的条目必须确认是图片；完全没有类型信息的条目视为纯图片流（如 image_gen）
  function filterImages(items) {
    return items.filter((item) => !hasTypeEvidence(item) || looksLikeImage(item));
  }

  function buildCapturedPath(rawUrl, { limit, after }) {
    const url = new URL(rawUrl, BASE);
    if (limit) url.searchParams.set("limit", String(limit));
    const cursorParam = ["cursor", "after", "next", "offset"].find((name) => url.searchParams.has(name));
    if (after) {
      if (cursorParam) {
        url.searchParams.set(cursorParam, after);
      } else {
        url.searchParams.set("after", after);
        url.searchParams.set("cursor", after);
      }
    } else if (cursorParam) {
      url.searchParams.delete(cursorParam);
    }
    return `${url.pathname}?${url.searchParams.toString()}`;
  }

  function createApiClient(options = {}) {
    const fetchImpl = options.fetch || scope.fetch.bind(scope);
    const wait = options.wait || defaultWait;
    const maxRetries = options.maxRetries ?? 5;
    const capturedList = options.capturedList || null;
    let accessToken = options.accessToken || null;
    let listEndpoint = options.listEndpoint || null;
    let listSource = null;

    async function authHeaders() {
      if (!accessToken) {
        const response = await fetchImpl(`${BASE}/api/auth/session`, { credentials: "include" });
        if (!response.ok) {
          throw new Error(`无法获取登录会话（HTTP ${response.status}），请先登录 ChatGPT`);
        }
        const session = await response.json();
        accessToken = session?.accessToken;
        if (!accessToken) throw new Error("未登录 ChatGPT，请先登录后重试");
      }
      return { Authorization: `Bearer ${accessToken}` };
    }

    async function request(path, init = {}) {
      for (let attempt = 0; ; attempt += 1) {
        const headers = { ...(await authHeaders()), ...(init.headers || {}) };
        let response;
        try {
          response = await fetchImpl(`${BASE}${path}`, { credentials: "include", ...init, headers });
        } catch (error) {
          // 网络抖动（断网、连接被重置等）
          if (attempt < maxRetries) {
            await wait(Math.min(30000, 1000 * 2 ** attempt));
            continue;
          }
          throw error;
        }
        if (response.status === 401 && attempt === 0) {
          accessToken = null;
          continue;
        }
        // 429 限流和 5xx 服务端临时故障都退避重试
        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          const retryAfter = Number(response.headers?.get?.("retry-after"));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(30000, 1000 * 2 ** attempt);
          await wait(backoff);
          continue;
        }
        return response;
      }
    }

    async function tryListEndpoint(candidate, { limit, after }) {
      const query = new URLSearchParams({ limit: String(limit), ...(candidate.params || {}) });
      if (after) {
        // 游标参数名不确定，同时携带两种；服务端会忽略不认识的参数
        query.set("after", after);
        query.set("cursor", after);
      }
      const response = await request(`${candidate.path}?${query.toString()}`, { method: "GET" });
      if (!response.ok) return { ok: false, status: response.status };
      const data = await response.json().catch(() => null);
      const items = extractItems(data);
      if (!items) return { ok: false, status: response.status };
      return { ok: true, items, cursor: extractCursor(data) };
    }

    async function listImages({ limit = 100, after = null } = {}) {
      // 优先复用页面自己使用的列表接口（由 page-hook 捕获）
      if (capturedList?.url) {
        const path = buildCapturedPath(capturedList.url, { limit, after });
        const response = await request(path, { method: "GET" });
        if (response.ok) {
          const data = await response.json().catch(() => null);
          const items = extractItems(data);
          if (items) {
            listSource = `页面捕获 ${new URL(capturedList.url, BASE).pathname}`;
            // 接口已按 categories=image 过滤时，直接信任服务端结果
            const trusted = /categories=image/.test(String(capturedList.url));
            return { items: trusted ? items : filterImages(items), cursor: extractCursor(data) };
          }
        }
        console.warn("[图片清理器] 捕获的列表接口失效（HTTP", response.status, "），改用候选探测");
      }
      if (listEndpoint) {
        const result = await tryListEndpoint(listEndpoint, { limit, after });
        if (!result.ok) throw new Error(`读取图片列表失败（HTTP ${result.status}）`);
        return { items: listEndpoint.trust ? result.items : filterImages(result.items), cursor: result.cursor };
      }
      const failures = [];
      for (const candidate of LIST_CANDIDATES) {
        const result = await tryListEndpoint(candidate, { limit, after });
        if (result.ok) {
          listEndpoint = candidate;
          listSource = `候选探测 ${candidate.path}`;
          console.info("[图片清理器] 列表接口探测成功:", candidate.path);
          return { items: candidate.trust ? result.items : filterImages(result.items), cursor: result.cursor };
        }
        failures.push(`${candidate.path} → HTTP ${result.status}`);
      }
      throw new Error(`所有候选列表接口都不可用：${failures.join("；")}。请在资料库页面打开插件重试`);
    }

    async function deleteImage(item) {
      const libId = libraryFileId(item);
      if (libId) {
        const params = new URLSearchParams({ soft_delete: "true" });
        const underlying = fileId(item);
        const directory = parentDirectoryId(item);
        const name = fileName(item);
        if (underlying) params.set("file_id", underlying);
        if (directory) params.set("parent_directory_id", directory);
        if (name) params.set("file_name", name);
        const response = await request(
          `/backend-api/files/library/files/${encodeURIComponent(libId)}/delete_stream?${params.toString()}`,
          { method: "POST" }
        );
        if (response.status === 404) return { ok: true, gone: true };
        if (!response.ok) return { ok: false, status: response.status };
        return { ok: true };
      }
      const legacyId = fileId(item);
      if (!legacyId) return { ok: false, status: "无法识别的条目 ID" };
      const response = await request(`/backend-api/files/${encodeURIComponent(legacyId)}`, { method: "DELETE" });
      if (response.status === 404) return { ok: true, gone: true };
      if (!response.ok) return { ok: false, status: response.status };
      return { ok: true };
    }

    function describe() {
      return listSource || "尚未调用列表接口";
    }

    return Object.freeze({ listImages, deleteImage, imageId, describe });
  }

  scope.ChatGPTImageCleanerApi = Object.freeze({
    createApiClient,
    imageId,
    looksLikeImage,
    libraryFileId,
    fileId,
    parentDirectoryId,
    fileName
  });
})(globalThis);
