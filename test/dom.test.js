import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../src/dom.js", import.meta.url), "utf8");

function helpers(html) {
  const dom = new JSDOM(html, { url: "https://chatgpt.com/library" });
  const context = vm.createContext({ document: dom.window.document });
  context.globalThis = context;
  vm.runInContext(source, context);
  return { doc: dom.window.document, api: context.ChatGPTImageCleanerDOM };
}

test("findImageItems recognizes image files rendered as table rows", () => {
  const { doc, api } = helpers(`
    <main>
      <table>
        <thead><tr><th>名称</th><th>修改时间</th><th>大小</th></tr></thead>
        <tbody>
          <tr><td><input type="checkbox"><img src="thumb">photo.png</td><td>8月3日</td><td>2 MB</td></tr>
          <tr><td><input type="checkbox">notes.pdf</td><td>8月3日</td><td>20 KB</td></tr>
        </tbody>
      </table>
    </main>
  `);

  const items = api.findImageItems(doc);
  assert.equal(items.length, 1);
  assert.equal(items[0].tagName, "TR");
  assert.match(items[0].textContent, /photo\.png/);
});

test("findImageItems recognizes grid rows anchored by a checkbox and image filename", () => {
  const { doc, api } = helpers(`
    <main>
      <div class="library-table">
        <div class="header"><span>名称</span><span>修改时间</span><span>大小</span></div>
        <div class="file-row"><button role="checkbox" aria-checked="false"></button><span>generated-image.webp</span><span>2 MB</span></div>
        <div class="file-row"><button role="checkbox" aria-checked="false"></button><span>report.docx</span><span>30 KB</span></div>
      </div>
    </main>
  `);

  const items = api.findImageItems(doc);
  assert.equal(items.length, 1);
  assert.match(items[0].textContent, /generated-image\.webp/);
});

test("findImageItems ignores images outside the library main content", () => {
  const { doc, api } = helpers(`
    <nav><article><img src="avatar.png" alt="profile image"></article></nav>
    <main><div class="file-row"><input type="checkbox"><span>library-photo.jpg</span></div></main>
  `);

  const items = api.findImageItems(doc);
  assert.equal(items.length, 1);
  assert.match(items[0].textContent, /library-photo\.jpg/);
});
