import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/api-client.js';
import '../src/cleaner.js';
import '../src/popup-logic.js';
const apiModule = globalThis.ChatGPTImageCleanerApi;
const cleaner = globalThis.ChatGPTImageCleaner;
const image = { id: 'libfile_test', file_id: 'file_test', directory_id: 'libdir_test',
  file_name: 'photo.jpg', mime_type: 'image/jpeg', file_upload_time: '2020-01-01T00:00:00Z' };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const client = (fetch) => apiModule.createApiClient({ fetch, accessToken: 'test', maxRetries: 0 });

test('POST lists mixed items and sends opaque cursor in JSON with both image sources enabled', async () => {
  const api = client(async (url, init) => {
    assert.equal(url, 'https://chatgpt.com/backend-api/files/library');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    const body = JSON.parse(init.body);
    assert.equal(body.cursor, 'opaque-cursor');
    assert.equal(body.limit, 50);
    assert.equal(body.include_uploaded_files, true);
    assert.equal(body.include_imagegen_files, true);
    return response({ items: [image, { id: 'libfile_pdf', mime_type: 'application/pdf' },
      { id: 'page_test', file_name: 'image.jpg' }, { ...image, id: 'libfile_trashed', trashed_at: 'today' }], cursor: 'next' });
  });
  assert.deepEqual(await api.listImages({ after: 'opaque-cursor', limit: 500 }), { items: [image], cursor: 'next' });
});

test('delete-batch sends exact file metadata and validates per-file success', async () => {
  const api = client(async (url, init) => {
    assert.equal(url, 'https://chatgpt.com/backend-api/files/library/files/delete-batch');
    assert.deepEqual(JSON.parse(init.body), { files: [{ library_file_id: image.id, file_id: image.file_id,
      parent_directory_id: image.directory_id, file_name: image.file_name }] });
    return response({ success: true, files: [{ library_file_id: image.id, success: true, status_code: 200 }] });
  });
  assert.deepEqual(await api.deleteImage(image), { ok: true });
});

test('HTTP 200 failure, absent file confirmation, malformed JSON and HTTP 404 are not success', async () => {
  for (const result of [response({ success: false, files: [{ library_file_id: image.id, success: false, status_code: 403 }] }),
    response({ success: true, files: [] }), response(null), response({}, 404)]) {
    assert.equal((await client(async () => result).deleteImage(image)).ok, false);
  }
});

test('non-images and incomplete deletion metadata never make a request', async () => {
  const api = client(async () => { throw new Error('unexpected request'); });
  for (const item of [{ ...image, mime_type: 'application/pdf' }, { ...image, file_id: null },
    { ...image, directory_id: null }, { ...image, trashed_at: 'today' }]) {
    assert.equal((await api.deleteImage(item)).ok, false);
  }
});

test('scan crosses pages without images and deduplicates IDs', async () => {
  const api = { imageId: apiModule.imageId, listImages: async ({ after }) => after === null
    ? { items: [], cursor: 'second' } : after === 'second'
      ? { items: [image], cursor: 'third' } : { items: [image], cursor: null } };
  assert.deepEqual(await cleaner.scanImages({ api }), { count: 1, complete: true });
});

test('repeated scan cursor is reported as incomplete', async () => {
  const api = { imageId: apiModule.imageId, listImages: async () => ({ items: [], cursor: 'same' }) };
  await assert.rejects(cleaner.scanImages({ api }), /游标重复/);
});

test('delete crosses non-image pages and checks age using upload time', async () => {
  let exists = true;
  let deletes = 0;
  const api = { imageId: apiModule.imageId, listImages: async ({ after }) => after === null
    ? { items: [], cursor: 'images' } : { items: exists ? [image] : [], cursor: null },
    deleteImage: async () => { deletes++; exists = false; return { ok: true }; } };
  const result = await cleaner.deleteAllImages({ api, minAgeDays: 7, interDeleteDelay: 0,
    emptyRechecks: 0, emptyRecheckDelay: 0 });
  assert.equal(result.deleted, 1);
  assert.equal(deletes, 1);
});

test('successful response with unchanged library triggers verification failure', async () => {
  const api = { imageId: apiModule.imageId, listImages: async () => ({ items: [image], cursor: null }),
    deleteImage: async () => ({ ok: true }) };
  await assert.rejects(cleaner.deleteAllImages({ api, interDeleteDelay: 0, emptyRechecks: 0 }), /图片仍在资料库/);
});

test('malformed list response stops instead of reporting an empty library', async () => {
  await assert.rejects(client(async () => response({ files: [] })).listImages(), /响应格式/);
});

test('HTTP 200 with per-file 429 retries before marking failure', async () => {
  let calls = 0;
  const delays = [];
  const api = apiModule.createApiClient({ accessToken: 'test', maxRetries: 1,
    wait: async (ms) => delays.push(ms), fetch: async () => {
      calls++;
      return response({ success: calls > 1, files: [{ library_file_id: image.id,
        success: calls > 1, status_code: calls > 1 ? 200 : 429 }] });
    } });
  assert.deepEqual(await api.deleteImage(image), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1000]);
});

test('three rolling workers start next work while a slow request is still pending', { timeout: 2000 }, async () => {
  const images = Array.from({ length: 7 }, (_, i) => ({ ...image, id: `libfile_${i}` }));
  const remaining = new Map(images.map(item => [item.id, item]));
  let releaseSlow;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  let notifyFourth;
  const fourth = new Promise(resolve => { notifyFourth = resolve; });
  let active = 0, peak = 0, calls = 0;
  const api = { imageId: apiModule.imageId,
    listImages: async () => ({ items: [...remaining.values()], cursor: null }),
    deleteImage: async (item) => {
      calls++; active++; peak = Math.max(peak, active);
      if (calls === 4) notifyFourth();
      if (item.id === 'libfile_0') await slow;
      else await new Promise(resolve => setImmediate(resolve));
      remaining.delete(item.id); active--;
      return { ok: true };
    }
  };
  const run = cleaner.deleteAllImages({ api, concurrency: 3, interDeleteDelay: 0,
    emptyRechecks: 0, emptyRecheckDelay: 0 });
  await fourth;
  assert.equal(remaining.has('libfile_0'), true);
  releaseSlow();
  const result = await run;
  assert.equal(result.deleted, 7);
  assert.equal(peak, 3);
});

test('failure reasons survive progress and completion and render in popup', async () => {
  let exists = true;
  const events = [];
  const bad = { ...image, id: 'libfile_bad' };
  const api = { imageId: apiModule.imageId,
    listImages: async () => ({ items: exists ? [image, bad] : [bad], cursor: null }),
    deleteImage: async (item) => {
      if (item.id === bad.id) return { ok: false, status: '单文件 HTTP 403' };
      exists = false; return { ok: true };
    }
  };
  const result = await cleaner.deleteAllImages({ api, concurrency: 2, interDeleteDelay: 0,
    emptyRechecks: 0, emptyRecheckDelay: 0, onProgress: event => events.push(event) });
  assert.deepEqual(result.failureReasons, { '单文件 HTTP 403': 1 });
  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 1);
  assert.match(globalThis.ChatGPTImageCleanerPopup.formatDeleteProgress(result), /单文件 HTTP 403/);
  assert.equal(events.some(event => event.failureReasons?.['单文件 HTTP 403'] === 1), true);
});

test('409 is skipped immediately without retrying either HTTP layer', async () => {
  for (const outerStatus of [200, 409]) {
    let calls = 0;
    const api = apiModule.createApiClient({ accessToken: 'test',
      wait: async () => { throw new Error('409 must not wait'); },
      fetch: async () => {
        calls++;
        return response({ success: false, files: [{ library_file_id: image.id, success: false, status_code: 409 }] }, outerStatus);
      } });
    const result = await api.deleteImage(image);
    assert.equal(result.ok, false);
    assert.match(result.status, /409/);
    assert.equal(calls, 1);
  }
});

test('duplicate entries within a page and stale entries across rounds are deleted once', async () => {
  for (const concurrency of [1, 3]) {
    let listCalls = 0;
    const deleteCalls = [];
    const other = { ...image, id: 'libfile_other', file_id: 'file_other' };
    const api = { imageId: apiModule.imageId,
      listImages: async () => {
        listCalls++;
        if (listCalls === 1) return { items: [image, image, other, { ...image }], cursor: null };
        if (listCalls === 2) return { items: [], cursor: null }; // 删除后的复查
        if (listCalls === 3) return { items: [image, other, image], cursor: 'next' }; // 旧索引再次返回
        return { items: [], cursor: null };
      },
      deleteImage: async item => { deleteCalls.push(item.id); return { ok: true }; }
    };
    const result = await cleaner.deleteAllImages({ api, concurrency, interDeleteDelay: 0,
      emptyRechecks: 0, emptyRecheckDelay: 0 });
    assert.deepEqual(deleteCalls.sort(), [image.id, other.id].sort());
    assert.equal(result.deleted, 2);
    assert.equal(result.failed, 0);
    assert.equal(listCalls, 4);
  }
});

async function loadApi() { return globalThis.ChatGPTImageCleanerApi; }
test("fetches the session token once and reuses it", async () => {
  const { createApiClient } = await loadApi();
  const requests = [];
  const client = createApiClient({
    wait: async () => {},
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.includes("/api/auth/session")) return response({ accessToken: "token-1" });
      return response({ items: [], cursor: null });
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
    fetch: async () => response({}, 200)
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
        return response({ accessToken: `token-${tokenIndex}` });
      }
      backendAttempts += 1;
      if (backendAttempts === 1) return response({}, 401);
      return response({ items: [{ id: "libfile_1", mime_type: "image/png" }], cursor: null });
    }
  });
  const page = await client.listImages({});
  assert.equal(page.items.length, 1);
  assert.equal(tokenIndex, 2);
});
