import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import "../src/api-client.js";
import "../src/cleaner.js";
import "../src/popup-logic.js";

test("ZIP MIME is eligible while PDFs and documents stay outside the scope", () => {
  const { looksLikeImage } = globalThis.ChatGPTImageCleanerApi;
  assert.equal(looksLikeImage({ mime_type: "application/zip", file_name: "archive.zip" }), true);
  assert.equal(looksLikeImage({ mime_type: "application/pdf", file_name: "archive.zip" }), false);
  assert.equal(looksLikeImage({ mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), false);
});

test("popup offers 1/3 day choices and states that ZIP files will be deleted", async () => {
  const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const doc = new JSDOM(html).window.document;
  assert.deepEqual([...doc.querySelectorAll("#age option")].map(option => option.value), ["0", "1", "3", "7", "30", "90"]);
  assert.match(doc.querySelector("#age option").textContent, /ZIP/);
  assert.match(doc.querySelector("#scan").textContent, /ZIP/);
});

test("1/3 day filters use strict 24-hour cutoffs for ZIP and keep newer or unknown timestamps", async () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  for (const days of [1, 3]) {
    const cutoff = now - days * 86400000;
    const store = [
      { id: "old", mime_type: "application/zip", created_at: new Date(cutoff - 1).toISOString() },
      { id: "boundary", mime_type: "application/zip", created_at: new Date(cutoff).toISOString() },
      { id: "new", mime_type: "image/png", created_at: new Date(cutoff + 1).toISOString() },
      { id: "unknown", mime_type: "application/zip" }
    ];
    const deleted = [];
    const api = {
      imageId: item => item.id,
      listImages: async () => ({ items: store.slice(), cursor: null }),
      deleteImage: async item => {
        deleted.push(item.id);
        store.splice(store.findIndex(entry => entry.id === item.id), 1);
        return { ok: true };
      }
    };
    const result = await globalThis.ChatGPTImageCleaner.deleteAllImages({ api, minAgeDays: days,
      now: () => now, interDeleteDelay: 0, emptyRecheckDelay: 0, emptyRechecks: 0 });
    assert.equal(result.deleted, 1);
    assert.deepEqual(deleted, ["old"]);
    assert.deepEqual(store.map(item => item.id), ["boundary", "new", "unknown"]);
  }
});
