(function installCleaner(scope) {
  "use strict";

  function throwIfAborted(signal) {
    if (signal?.aborted) throw new Error("操作已取消");
  }

  function defaultWait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function itemTimestamp(item) {
    const fields = [
      item?.created_at, item?.create_time, item?.created, item?.updated_at,
      item?.file?.created_at, item?.node?.created_at, item?.metadata?.created_at
    ];
    for (const value of fields) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value > 1e12 ? value : value * 1000;
      }
      if (typeof value === "string" && value) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return null;
  }

  async function scanImages(options) {
    const {
      api,
      onProgress = () => {},
      signal,
      pageLimit = 500,
      maxPages = 1000
    } = options;
    let total = 0;
    let after = null;
    const seenCursors = new Set();

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      throwIfAborted(signal);
      const page = await api.listImages({ limit: pageLimit, after });
      total += page.items.length;
      onProgress({ phase: "scanning", total });
      if (!page.cursor || page.items.length === 0 || seenCursors.has(page.cursor)) {
        return { count: total, complete: true };
      }
      seenCursors.add(page.cursor);
      after = page.cursor;
    }
    return { count: total, complete: false };
  }

  async function deleteAllImages(options) {
    const {
      api,
      onProgress = () => {},
      signal,
      wait = defaultWait,
      pageLimit = 100,
      concurrency = 3,
      interDeleteDelay = 100,
      maxRounds = 100000,
      minAgeDays = 0,
      total = null,
      // 软删除在服务端生效有延迟，列表可能短暂返回空页；
      // 结束前需从头多轮确认为空（递增等待，总计约 50 秒），避免提前停止
      emptyRecheckDelay = 2500,
      emptyRechecks = 8,
      // 列表接口偶发 5xx/网络错误时，回到列表头重试的次数（请求层已各自重试过）
      listErrorRetries = 5,
      now = () => Date.now()
    } = options;
    throwIfAborted(signal);

    const threads = Math.max(1, Math.min(10, Math.floor(Number(concurrency)) || 1));
    const cutoff = Number(minAgeDays) > 0 ? now() - Number(minAgeDays) * 86400000 : null;

    let deleted = 0;
    const failed = new Map();
    const deletedIds = new Set();
    let emptyStreak = 0;

    async function confirmDrained() {
      if (deleted === 0) return true;
      emptyStreak += 1;
      if (emptyStreak > emptyRechecks) return true;
      // 回到列表头重新确认：软删除刷新索引后，旧的深层游标可能指向已清空的区域，
      // 停留在旧游标上会误判“已删完”
      resumeAfter = null;
      after = null;
      visitedCursors.clear();
      if (emptyRecheckDelay) await wait(emptyRecheckDelay * Math.min(emptyStreak, 3));
      return false;
    }
    // resumeAfter 锚定在“最前一段不可删除区域”（更新的图片/已失败项）之后，
    // 这样每轮删除后不必从头重新翻越这些页面。
    let resumeAfter = null;
    let after = null;
    const visitedCursors = new Set();
    let canaryDone = false;

    function isEligible(item, id) {
      if (!id || failed.has(id) || deletedIds.has(id)) return false;
      if (cutoff === null) return true;
      const timestamp = itemTimestamp(item);
      // 按时间过滤时，无法判断时间的项目一律保留
      return timestamp !== null && timestamp < cutoff;
    }

    let listFailures = 0;

    for (let round = 0; round < maxRounds; round += 1) {
      throwIfAborted(signal);
      let page;
      try {
        page = await api.listImages({ limit: pageLimit, after });
        listFailures = 0;
      } catch (error) {
        // 登录失效必须立即上报；其余列表故障（5xx、游标失效）回到列表头重试
        if (/未登录|请先登录/.test(String(error?.message))) throw error;
        listFailures += 1;
        if (listFailures > listErrorRetries) throw error;
        resumeAfter = null;
        after = null;
        visitedCursors.clear();
        if (emptyRecheckDelay) await wait(emptyRecheckDelay * Math.min(listFailures, 3));
        continue;
      }
      const entries = page.items.map((item) => ({ item, id: api.imageId(item) }));
      const eligible = entries.filter(({ item, id }) => isEligible(item, id));

      if (entries.length === 0) {
        if (after === resumeAfter) {
          if (await confirmDrained()) break;
          continue;
        }
        after = resumeAfter;
        continue;
      }
      if (eligible.length === 0) {
        if (!page.cursor || visitedCursors.has(page.cursor)) {
          if (await confirmDrained()) break;
          continue;
        }
        visitedCursors.add(page.cursor);
        resumeAfter = page.cursor;
        after = page.cursor;
        continue;
      }
      emptyStreak = 0;

      let deletedThisRound = 0;
      for (let index = 0; index < eligible.length; index += threads) {
        throwIfAborted(signal);
        const chunk = eligible.slice(index, index + threads);
        const results = await Promise.all(chunk.map((entry) => api.deleteImage(entry.item)));
        results.forEach((result, position) => {
          if (result.ok) {
            deleted += 1;
            deletedThisRound += 1;
            deletedIds.add(chunk[position].id);
          } else {
            failed.set(chunk[position].id, result.status);
          }
        });
        const lastFailure = results.find((result) => !result.ok);
        if (deleted === 0 && failed.size >= 5) {
          throw new Error(`删除接口连续失败（HTTP ${lastFailure?.status}），已停止；接口可能已变更`);
        }
        onProgress({ phase: "progress", deleted, failed: failed.size, total });
        if (interDeleteDelay) await wait(interDeleteDelay);
      }

      if (!canaryDone && deletedThisRound > 0) {
        let survivorCount = null;
        // 软删除生效有延迟，最多复查数次；只要有一次确认减少即视为删除有效
        try {
          for (let attempt = 0; attempt <= emptyRechecks; attempt += 1) {
            if (attempt > 0 && emptyRecheckDelay) await wait(emptyRecheckDelay);
            const check = await api.listImages({ limit: pageLimit, after: resumeAfter });
            const remainingIds = new Set(check.items.map((item) => api.imageId(item)));
            survivorCount = eligible.filter(({ id }) => !failed.has(id) && remainingIds.has(id)).length;
            if (survivorCount < deletedThisRound) break;
          }
        } catch (_) {
          survivorCount = null; // 列表暂时不可用，下一轮再校验
        }
        if (survivorCount !== null) canaryDone = true;
        if (survivorCount !== null && survivorCount >= deletedThisRound) {
          const withLib = eligible.filter(({ id }) => /^libfile/.test(String(id))).length;
          throw new Error(
            `删除请求返回成功但图片仍在资料库中，已停止（列表来源: ${api.describe?.() || "未知"}；` +
            `本批 ${eligible.length} 项中 ${withLib} 项带 libfile ID）`
          );
        }
      }

      visitedCursors.clear();
      after = resumeAfter;
    }

    const result = { deleted, failed: failed.size, remaining: failed.size };
    onProgress({ phase: "complete", ...result });
    return result;
  }

  scope.ChatGPTImageCleaner = Object.freeze({ deleteAllImages, scanImages, throwIfAborted, itemTimestamp });
})(globalThis);
