import test from "node:test";
import assert from "node:assert/strict";

async function loadController() {
  await import("../src/controller.js").catch(() => {});
  return globalThis.ChatGPTImageCleanerController || {};
}

const chatgptDoc = { location: { hostname: "chatgpt.com" } };

test("controller refuses commands outside chatgpt.com", async () => {
  const { createController } = await loadController();
  assert.equal(typeof createController, "function");
  const controller = createController({
    doc: { location: { hostname: "example.com" } },
    dom: { isLibraryPage: () => false },
    cleaner: {},
    apiFactory: () => ({})
  });
  await assert.rejects(() => controller.handle({ type: "scan" }), /chatgpt\.com/);
});

test("controller routes scan and delete commands and remembers the total", async () => {
  const { createController } = await loadController();
  const seen = [];
  const controller = createController({
    doc: chatgptDoc,
    dom: { isLibraryPage: () => true },
    cleaner: {
      scanImages: async () => ({ count: 42, complete: true }),
      deleteAllImages: async ({ total }) => {
        seen.push({ total });
        return { deleted: 42, failed: 0, remaining: 0 };
      }
    },
    apiFactory: () => ({})
  });
  assert.deepEqual(await controller.handle({ type: "scan" }), { count: 42, complete: true });
  assert.deepEqual(
    await controller.handle({ type: "delete" }),
    { deleted: 42, failed: 0, remaining: 0 }
  );
  assert.deepEqual(seen, [{ total: 42 }]);
});

test("status reports busy state and latest progress snapshot", async () => {
  const { createController } = await loadController();
  let releaseDelete;
  let emitProgress;
  const controller = createController({
    doc: chatgptDoc,
    dom: { isLibraryPage: () => true },
    cleaner: {
      deleteAllImages: async ({ onProgress }) => {
        emitProgress = onProgress;
        return new Promise((resolve) => { releaseDelete = () => resolve({ deleted: 1, failed: 0, remaining: 0 }); });
      }
    },
    apiFactory: () => ({})
  });

  const idle = await controller.handle({ type: "status" });
  assert.equal(idle.busy, false);
  assert.equal(idle.chatgpt, true);

  const pending = controller.handle({ type: "delete" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  emitProgress({ phase: "progress", deleted: 1, failed: 0, total: 10 });
  const during = await controller.handle({ type: "status" });
  assert.equal(during.busy, true);
  assert.deepEqual(during.progress, { phase: "progress", deleted: 1, failed: 0, total: 10 });

  releaseDelete();
  await pending;
  const after = await controller.handle({ type: "status" });
  assert.equal(after.busy, false);
});

test("controller rejects overlapping operations", async () => {
  const { createController } = await loadController();
  let release;
  const controller = createController({
    doc: chatgptDoc,
    dom: { isLibraryPage: () => true },
    cleaner: {
      scanImages: async () => new Promise((resolve) => { release = () => resolve({ count: 0, complete: true }); })
    },
    apiFactory: () => ({})
  });
  const pending = controller.handle({ type: "scan" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(() => controller.handle({ type: "scan" }), /已有操作正在进行/);
  release();
  await pending;
});
