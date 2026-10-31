import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

async function loadDomHelpers() {
  await import("../src/dom.js").catch(() => {});
  return globalThis.ChatGPTImageCleanerDOM || {};
}

function documentFor(body, url = "https://chatgpt.com/library") {
  return new JSDOM(body, { url }).window.document;
}

test("recognizes ChatGPT Library pages in English and Chinese", async () => {
  const { isLibraryPage } = await loadDomHelpers();
  assert.equal(typeof isLibraryPage, "function");
  assert.equal(isLibraryPage(documentFor('<main><h1>Library</h1></main>')), true);
  assert.equal(isLibraryPage(documentFor('<main><h1>资料库</h1></main>')), true);
  assert.equal(isLibraryPage(documentFor('<main><h1>Conversation</h1></main>', "https://chatgpt.com/c/123")), false);
});

test("discovers only image file cards", async () => {
  const { findImageItems } = await loadDomHelpers();
  assert.equal(typeof findImageItems, "function");
  const doc = documentFor(`
    <main aria-label="Library">
      <article data-testid="file-card"><img src="cat.jpg" alt="cat"><span>cat.jpg</span><input type="checkbox"></article>
      <article data-testid="file-card"><span>report.pdf</span><span>PDF</span><input type="checkbox"></article>
      <article data-testid="file-card"><span>Generated image</span><img src="generated.webp"><input type="checkbox"></article>
    </main>`);
  const items = findImageItems(doc);
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /cat/);
  assert.match(items[1].textContent, /Generated image/);
});

test("does not count nested card wrappers twice", async () => {
  const { findImageItems } = await loadDomHelpers();
  const doc = documentFor(`
    <main aria-label="Library">
      <article data-testid="file-card"><div role="listitem"><img src="cat.jpg"><input type="checkbox"></div></article>
    </main>`);
  assert.equal(findImageItems(doc).length, 1);
});

test("accepts a single explicit image deletion dialog", async () => {
  const { findSafeDeleteDialog } = await loadDomHelpers();
  assert.equal(typeof findSafeDeleteDialog, "function");
  const doc = documentFor(`
    <div role="dialog" aria-modal="true">
      <h2>Delete 3 images?</h2>
      <button>Cancel</button><button>Delete</button>
    </div>`);
  const result = findSafeDeleteDialog(doc);
  assert.equal(result?.confirmButton?.textContent, "Delete");
});

test("rejects ambiguous or account-level destructive dialogs", async () => {
  const { findSafeDeleteDialog } = await loadDomHelpers();
  assert.equal(typeof findSafeDeleteDialog, "function");
  const ambiguous = documentFor(`
    <div role="dialog"><h2>Delete?</h2><button>Delete</button></div>
    <div role="dialog"><h2>Delete image?</h2><button>Delete</button></div>`);
  assert.equal(findSafeDeleteDialog(ambiguous), null);

  const account = documentFor(`
    <div role="dialog"><h2>Delete account?</h2><button>Delete</button></div>`);
  assert.equal(findSafeDeleteDialog(account), null);
});
