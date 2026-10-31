import test from "node:test";
import assert from "node:assert/strict";

async function loadApi() {
  await import("../src/api-client.js").catch(() => {});
  return globalThis.ChatGPTImageCleanerApi || {};
}

function jsonResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body
  };
}

test("imageId prefers library file ids and falls back to file ids", async () => {
  const { imageId } = await loadApi();
  assert.equal(imageId({ id: "libfile_d8e8ac9d" }), "libfile_d8e8ac9d");
  assert.equal(imageId({ id: "libfile_x", file_id: "file_000086b8" }), "libfile_x");
  assert.equal(imageId({ id: "file-abc123" }), "file-abc123");
  assert.equal(imageId({ id: "file_0000086b" }), "file_0000086b");
  assert.equal(imageId({ id: "some-opaque-id" }), "some-opaque-id");
  assert.equal(imageId({}), null);
});

test("imageId digs long ids out of unknown nested node shapes", async () => {
  const { imageId } = await loadApi();
  const node = {
    node_id: "n1",
    file: { ref: "pointer libfile_d8e8ac9d63a0819199606251bfeba3ee end" },
    meta: { dir: "libdir_d66d03df0db08191b61f666d6398d114" }
  };
  assert.equal(imageId(node), "libfile_d8e8ac9d63a0819199606251bfeba3ee");
  // 深度搜索不会把 "file_name"/"libfile_id" 这类字段名当成 ID
  assert.equal(imageId({ file_name: "a.png", libfile_id: null }), null);
});

test("prefers the library nodes endpoint with categories=image and no client-side filtering", async () => {
  const { createApiClient } = await loadApi();
  const requested = [];
  const client = createApiClient({
    accessToken: "token",
    wait: async () => {},
    fetch: async (url) => {
      requested.push(url);
      if (url.includes("/backend-api/files/library/nodes?")) {
        return jsonResponse({
          nodes: [
            { id: "libfile_a1", name: "无扩展名的生成图" },
            { id: "libfile_a2", name: "b.png" }
          ],
          cursor: "cur-1"
        });
      }
      return jsonResponse({}, 404);
    }
  });
  const page = await client.listImages({ limit: 50 });
  // 服务端已按 categories=image 过滤，客户端不再按文件名二次过滤
  assert.equal(page.items.length, 2);
  assert.equal(page.cursor, "cur-1");
  assert.ok(requested[0].includes("categories=image"));
  await client.listImages({ limit: 50, after: "cur-1" });
  const second = requested.filter((url) => url.includes("/nodes?"))[1];
  assert.ok(second.includes("cursor=cur-1"));
  assert.ok(second.includes("categories=image"));
});

test("reuses a captured page list url, swapping cursor and limit", async () => {
  const { createApiClient } = await loadApi();
  const requested = [];
  const client = createApiClient({
    accessToken: "token",
    wait: async () => {},
    capturedList: { url: "https://chatgpt.com/backend-api/files/library/nodes?cursor=old-cursor&categories=image" },
    fetch: async (url) => {
      requested.push(url);
      return jsonResponse({ nodes: [{ id: "libfile_c1", name: "x" }], cursor: "cap-next" });
    }
  });
  const first = await client.listImages({ limit: 80 });
  assert.equal(first.items.length, 1);
  assert.ok(requested[0].includes("/backend-api/files/library/nodes?"));
  assert.ok(!requested[0].includes("old-cursor"), "首页请求应去掉页面里的旧游标");
  assert.ok(requested[0].includes("categories=image"));
  assert.ok(requested[0].includes("limit=80"));
  await client.listImages({ limit: 80, after: "cap-next" });
  assert.ok(requested[1].includes("cursor=cap-next"));
});

test("looksLikeImage keeps images and rejects documents and unknowns", async () => {
  const { looksLikeImage } = await loadApi();
  assert.equal(looksLikeImage({ mime_type: "image/png" }), true);
  assert.equal(looksLikeImage({ mime_type: "application/pdf", file_name: "a.png" }), false);
  assert.equal(looksLikeImage({ file_name: "photo.JPG" }), true);
  assert.equal(looksLikeImage({ file_name: "report.pdf" }), false);
  assert.equal(looksLikeImage({ file_type: "image" }), true);
  assert.equal(looksLikeImage({}), false);
});

test("discovers the working list endpoint and filters non-images", async () => {
  const { createApiClient } = await loadApi();
  const requested = [];
  const client = createApiClient({
    accessToken: "token",
    wait: async () => {},
    fetch: async (url) => {
      requested.push(url);
      if (url.includes("/backend-api/files/library/files?")) {
        return jsonResponse({
          items: [
            { id: "libfile_1", file_name: "a.png", mime_type: "image/png" },
            { id: "libfile_2", file_name: "doc.pdf", mime_type: "application/pdf" }
          ],
          cursor: "next-1"
        });
      }
      return jsonResponse({}, 404);
    }
  });
  const page = await client.listImages({ limit: 50 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, "libfile_1");
  assert.equal(page.cursor, "next-1");
  // 第二次调用直接使用已探测到的接口
  await client.listImages({ limit: 50, after: "next-1" });
  const libraryCalls = requested.filter((url) => url.includes("/backend-api/files/library/files?"));
  assert.equal(libraryCalls.length, 2);
  assert.ok(libraryCalls[1].includes("after=next-1"));
  assert.ok(libraryCalls[1].includes("cursor=next-1"));
});

test("falls back to the legacy image_gen endpoint when library endpoints are missing", async () => {
  const { createApiClient } = await loadApi();
  const client = createApiClient({
    accessToken: "token",
    wait: async () => {},
    fetch: async (url) => {
      if (url.includes("/backend-api/my/recent/image_gen")) {
        return jsonResponse({ items: [{ id: "file-gen-1" }], cursor: null });
      }
      return jsonResponse({}, 404);
    }
  });
  const page = await client.listImages({});
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, "file-gen-1");
});

test("errors clearly when no list endpoint works", async () => {
  const { createApiClient } = await loadApi();
  const client = createApiClient({
    accessToken: "token",
    wait: async () => {},
    fetch: async () => jsonResponse({}, 403)
  });
  await assert.rejects(() => client.listImages({}), /所有候选列表接口都不可用/);
});

test("deletes library files through delete_stream with full identifiers", async () => {
  const { createApiClient } = await loadApi();
  const requests = [];
  const client = createApiClient({
    accessToken: "token",
    wait: async () => {},
    fetch: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({});
    }
  });
  const result = await client.deleteImage({
    id: "libfile_d8e8ac9d",
    file_id: "file_0000086b",
    parent_directory_id: "libdir_d66d03df",
    file_name: "C3(1).jpg"
  });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  const { url, init } = requests[0];
  assert.equal(init.method, "POST");
  assert.ok(url.includes("/backend-api/files/library/files/libfile_d8e8ac9d/delete_stream?"));
  assert.ok(url.includes("soft_delete=true"));
  assert.ok(url.includes("file_id=file_0000086b"));
  assert.ok(url.includes("parent_directory_id=libdir_d66d03df"));
  assert.ok(url.includes("file_name=C3%281%29.jpg"));
});

test("falls back to legacy file delete when the item has no library id", async () => {
  const { createApiClient } = await loadApi();
  const requests = [];
  const client = createApiClient({
    accessToken: "token",
    wait: async () => {},
    fetch: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({});
    }
  });
  const result = await client.deleteImage({ id: "file-gen-1" });
  assert.equal(result.ok, true);
  assert.equal(requests[0].init.method, "DELETE");
  assert.ok(requests[0].url.includes("/backend-api/files/file-gen-1"));
});

test("reports failure for items without any recognizable id", async () => {
  const { createApiClient } = await loadApi();
  const client = createApiClient({ accessToken: "token", wait: async () => {}, fetch: async () => jsonResponse({}) });
  const result = await client.deleteImage({ id: "opaque" });
  assert.equal(result.ok, false);
});

test("backs off and retries on 429", async () => {
  const { createApiClient } = await loadApi();
  const waits = [];
  let attempts = 0;
  const client = createApiClient({
    accessToken: "token",
    wait: async (ms) => waits.push(ms),
    fetch: async (url, init) => {
      if (init?.method === "POST") {
        attempts += 1;
        if (attempts < 3) return jsonResponse({}, 429, { "retry-after": "1" });
        return jsonResponse({});
      }
      return jsonResponse({ items: [] });
    }
  });
  const result = await client.deleteImage({ id: "libfile_1" });
  assert.equal(result.ok, true);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1000, 1000]);
});

test("retries transient 5xx server errors with backoff", async () => {
  const { createApiClient } = await loadApi();
  const waits = [];
  let attempts = 0;
  const client = createApiClient({
    accessToken: "token",
    wait: async (ms) => waits.push(ms),
    fetch: async () => {
      attempts += 1;
      if (attempts < 3) return jsonResponse({}, 500);
      return jsonResponse({ nodes: [{ id: "libfile_1" }], cursor: null });
    }
  });
  const page = await client.listImages({});
  assert.equal(page.items.length, 1);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test("retries when fetch itself throws (network flake)", async () => {
  const { createApiClient } = await loadApi();
  let attempts = 0;
  const client = createApiClient({
    accessToken: "token",
    wait: async () => {},
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("Failed to fetch");
      return jsonResponse({ nodes: [{ id: "libfile_1" }], cursor: null });
    }
  });
  const page = await client.listImages({});
  assert.equal(page.items.length, 1);
  assert.equal(attempts, 2);
});

test("treats 404 on delete as already gone", async () => {
  const { createApiClient } = await loadApi();
  const client = createApiClient({
    accessToken: "token",
    wait: async () => {},
    fetch: async () => jsonResponse({}, 404)
  });
  const result = await client.deleteImage({ id: "libfile_1" });
  assert.deepEqual(result, { ok: true, gone: true });
});

test("fetches the session token once and reuses it", async () => {
  const { createApiClient } = await loadApi();
  const requests = [];
  const client = createApiClient({
    wait: async () => {},
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.includes("/api/auth/session")) return jsonResponse({ accessToken: "token-1" });
      return jsonResponse({ items: [], cursor: null });
    }
  });
  await client.listImages({});
  await client.listImages({});
  const sessionCalls = requests.filter((request) => request.url.includes("/api/auth/session"));
  assert.equal(sessionCalls.length, 1);
  const backendCalls = requests.filter((request) => request.url.includes("/backend-api/"));
  assert.ok(backendCalls.length >= 2);
  assert.equal(backendCalls[0].init.headers.Authorization, "Bearer token-1");
});

test("rejects clearly when not logged in", async () => {
  const { createApiClient } = await loadApi();
  const client = createApiClient({
    wait: async () => {},
    fetch: async () => jsonResponse({}, 200)
  });
  await assert.rejects(() => client.listImages({}), /未登录/);
});

test("refreshes the token once on 401", async () => {
  const { createApiClient } = await loadApi();
  let tokenIndex = 0;
  let backendAttempts = 0;
  const client = createApiClient({
    wait: async () => {},
    fetch: async (url) => {
      if (url.includes("/api/auth/session")) {
        tokenIndex += 1;
        return jsonResponse({ accessToken: `token-${tokenIndex}` });
      }
      backendAttempts += 1;
      if (backendAttempts === 1) return jsonResponse({}, 401);
      return jsonResponse({ items: [{ id: "libfile_1", mime_type: "image/png" }], cursor: null });
    }
  });
  const page = await client.listImages({});
  assert.equal(page.items.length, 1);
  assert.equal(tokenIndex, 2);
});
