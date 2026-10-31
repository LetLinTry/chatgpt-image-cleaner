import test from "node:test";
import assert from "node:assert/strict";

async function loadCleaner() {
  await import("../src/cleaner.js").catch(() => {});
  return globalThis.ChatGPTImageCleaner || {};
}

function fakeApi(store, options = {}) {
  const failIds = new Set(options.failIds || []);
  const calls = { list: 0, delete: [] };
  const toItem = (entry) => (typeof entry === "string" ? { id: entry } : entry);
  const api = {
    imageId: (item) => item.id,
    listImages: async ({ limit = 100, after = null } = {}) => {
      calls.list += 1;
      const start = after ? Number(after) : 0;
      const items = store.slice(start, start + limit).map(toItem);
      const nextStart = start + limit;
      return { items, cursor: nextStart < store.length ? String(nextStart) : null };
    },
    deleteImage: async (item) => {
      const id = item.id;
      calls.delete.push(id);
      if (failIds.has(id)) return { ok: false, status: 403 };
      const index = store.findIndex((entry) => toItem(entry).id === id);
      if (index >= 0) store.splice(index, 1);
      return { ok: true };
    }
  };
  return { api, calls };
}

test("scan counts every page through the API", async () => {
  const { scanImages } = await loadCleaner();
  const store = Array.from({ length: 1234 }, (_, index) => `file-${index}`);
  const { api } = fakeApi(store);
  const events = [];
  const result = await scanImages({ api, pageLimit: 500, onProgress: (event) => events.push(event) });
  assert.equal(result.count, 1234);
  assert.equal(result.complete, true);
  assert.ok(events.every((event) => event.phase === "scanning"));
});

test("deletes everything across many pages", async () => {
  const { deleteAllImages } = await loadCleaner();
  const store = Array.from({ length: 350 }, (_, index) => `file-${index}`);
  const { api } = fakeApi(store);
  const result = await deleteAllImages({
    
    api,
    pageLimit: 100,
    interDeleteDelay: 0, emptyRecheckDelay: 0
  });
  assert.equal(result.deleted, 350);
  assert.equal(result.failed, 0);
  assert.equal(store.length, 0);
});

test("skips items that keep failing and still finishes the rest", async () => {
  const { deleteAllImages } = await loadCleaner();
  const store = Array.from({ length: 30 }, (_, index) => `file-${index}`);
  const { api } = fakeApi(store, { failIds: ["file-3", "file-17"] });
  const result = await deleteAllImages({
    
    api,
    pageLimit: 10,
    interDeleteDelay: 0, emptyRecheckDelay: 0
  });
  assert.equal(result.deleted, 28);
  assert.equal(result.failed, 2);
  assert.deepEqual(store.sort(), ["file-17", "file-3"]);
});

test("fails closed when the delete endpoint keeps rejecting from the start", async () => {
  const { deleteAllImages } = await loadCleaner();
  const store = Array.from({ length: 20 }, (_, index) => `file-${index}`);
  const { api } = fakeApi(store, { failIds: store.slice() });
  await assert.rejects(
    () => deleteAllImages({  api, pageLimit: 10, interDeleteDelay: 0, emptyRecheckDelay: 0 }),
    /删除接口连续失败/
  );
});

test("fails closed when deletes claim success but images remain (canary)", async () => {
  const { deleteAllImages } = await loadCleaner();
  const store = Array.from({ length: 5 }, (_, index) => `file-${index}`);
  const api = {
    imageId: (item) => item.id,
    listImages: async () => ({ items: store.map((id) => ({ id })), cursor: null }),
    deleteImage: async () => ({ ok: true })
  };
  await assert.rejects(
    () => deleteAllImages({  api, interDeleteDelay: 0, emptyRecheckDelay: 0 }),
    /仍在资料库中/
  );
});

test("keeps going when the list is briefly empty after soft deletes", async () => {
  const { deleteAllImages } = await loadCleaner();
  const store = Array.from({ length: 40 }, (_, index) => `file-${index}`);
  let lagging = false;
  let laggedResponses = 0;
  const api = {
    imageId: (item) => item.id,
    listImages: async ({ limit = 100 } = {}) => {
      // 模拟软删除后的服务端延迟：每次删除后第一次列表返回空页
      if (lagging) {
        lagging = false;
        laggedResponses += 1;
        return { items: [], cursor: null };
      }
      return { items: store.slice(0, limit).map((id) => ({ id })), cursor: null };
    },
    deleteImage: async (item) => {
      store.splice(store.indexOf(item.id), 1);
      lagging = true;
      return { ok: true };
    }
  };
  const result = await deleteAllImages({ api, pageLimit: 10, interDeleteDelay: 0, emptyRecheckDelay: 0 });
  assert.equal(result.deleted, 40);
  assert.equal(store.length, 0);
  assert.ok(laggedResponses > 0, "测试应真的触发过延迟空页");
});

test("recovers when a stale deep cursor turns empty while items remain at the head", async () => {
  const { deleteAllImages } = await loadCleaner();
  const live = Array.from({ length: 60 }, (_, index) => `file-${index}`);
  const ghosts = []; // 软删除后仍滞留在索引头部的条目
  let listCalls = 0;
  const api = {
    imageId: (item) => item.id,
    listImages: async ({ limit = 100, after = null } = {}) => {
      listCalls += 1;
      if (listCalls % 4 === 0) ghosts.length = 0; // 索引周期性刷新，幽灵条目消失，游标含义随之偏移
      const combined = [...ghosts, ...live];
      const start = after ? Number(after) : 0;
      const items = combined.slice(start, start + limit).map((id) => ({ id }));
      const nextStart = start + limit;
      return { items, cursor: nextStart < combined.length ? String(nextStart) : null };
    },
    deleteImage: async (item) => {
      live.splice(live.indexOf(item.id), 1);
      ghosts.push(item.id);
      return { ok: true };
    }
  };
  const result = await deleteAllImages({ api, pageLimit: 10, interDeleteDelay: 0, emptyRecheckDelay: 0 });
  assert.equal(result.deleted, 60);
  assert.equal(live.length, 0);
});

test("survives intermittent list failures by restarting from the head", async () => {
  const { deleteAllImages } = await loadCleaner();
  const store = Array.from({ length: 50 }, (_, index) => `file-${index}`);
  let listCalls = 0;
  const api = {
    imageId: (item) => item.id,
    listImages: async ({ limit = 100 } = {}) => {
      listCalls += 1;
      if (listCalls % 3 === 0) throw new Error("读取图片列表失败（HTTP 500）");
      return { items: store.slice(0, limit).map((id) => ({ id })), cursor: null };
    },
    deleteImage: async (item) => {
      store.splice(store.indexOf(item.id), 1);
      return { ok: true };
    }
  };
  const result = await deleteAllImages({ api, pageLimit: 10, interDeleteDelay: 0, emptyRecheckDelay: 0 });
  assert.equal(result.deleted, 50);
  assert.equal(store.length, 0);
});

test("gives up after persistent list failures and reports the error", async () => {
  const { deleteAllImages } = await loadCleaner();
  const api = {
    imageId: (item) => item.id,
    listImages: async () => { throw new Error("读取图片列表失败（HTTP 500）"); },
    deleteImage: async () => ({ ok: true })
  };
  await assert.rejects(
    () => deleteAllImages({ api, interDeleteDelay: 0, emptyRecheckDelay: 0 }),
    /HTTP 500/
  );
});

test("age filter only deletes images older than the cutoff", async () => {
  const { deleteAllImages } = await loadCleaner();
  const NOW = Date.parse("2026-08-04T00:00:00Z");
  const day = 86400000;
  // 列表新→旧排序：前面是最近的图片，后面是旧图
  const store = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `new-file-${index}`, created_at: (NOW - index * day) / 1000 })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `old-file-${index}`, created_at: (NOW - (40 + index) * day) / 1000 }))
  ];
  const { api } = fakeApi(store);
  const result = await deleteAllImages({
    api,
    pageLimit: 3,
    minAgeDays: 30,
    interDeleteDelay: 0, emptyRecheckDelay: 0,
    now: () => NOW
  });
  assert.equal(result.deleted, 6);
  assert.deepEqual(store.map((entry) => entry.id), ["new-file-0", "new-file-1", "new-file-2", "new-file-3", "new-file-4"]);
});

test("age filter keeps items whose age cannot be determined", async () => {
  const { deleteAllImages } = await loadCleaner();
  const NOW = Date.parse("2026-08-04T00:00:00Z");
  const store = [
    { id: "file-unknown-date" },
    { id: "file-old", created_at: (NOW - 100 * 86400000) / 1000 }
  ];
  const { api } = fakeApi(store);
  const result = await deleteAllImages({ api, minAgeDays: 7, interDeleteDelay: 0, emptyRecheckDelay: 0, now: () => NOW });
  assert.equal(result.deleted, 1);
  assert.deepEqual(store.map((entry) => entry.id), ["file-unknown-date"]);
});

test("respects the requested concurrency", async () => {
  const { deleteAllImages } = await loadCleaner();
  const store = Array.from({ length: 20 }, (_, index) => `file-${index}`);
  let inFlight = 0;
  let peak = 0;
  const api = {
    imageId: (item) => item.id,
    listImages: async ({ limit = 100 } = {}) => ({ items: store.slice(0, limit).map((id) => ({ id })), cursor: null }),
    deleteImage: async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      store.splice(store.indexOf(item.id), 1);
      return { ok: true };
    }
  };
  await deleteAllImages({ api, concurrency: 5, interDeleteDelay: 0, emptyRecheckDelay: 0 });
  assert.equal(peak, 5);
});

test("deletion stops when cancelled", async () => {
  const { deleteAllImages } = await loadCleaner();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => deleteAllImages({
      
      signal: controller.signal,
      api: {}
    }),
    /已取消/
  );
});

test("reports progress with the scanned total", async () => {
  const { deleteAllImages } = await loadCleaner();
  const store = Array.from({ length: 12 }, (_, index) => `file-${index}`);
  const { api } = fakeApi(store);
  const events = [];
  await deleteAllImages({
    
    api,
    total: 12,
    pageLimit: 5,
    interDeleteDelay: 0, emptyRecheckDelay: 0,
    onProgress: (event) => events.push(event)
  });
  const progressEvents = events.filter((event) => event.phase === "progress");
  assert.ok(progressEvents.length >= Math.ceil(12 / 3));
  assert.equal(progressEvents.at(-1).deleted, 12);
  assert.ok(progressEvents.every((event) => event.total === 12));
  assert.equal(events.at(-1).phase, "complete");
  assert.equal(events.at(-1).deleted, 12);
});
