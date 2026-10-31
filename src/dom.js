(function installDomHelpers(scope) {
  "use strict";

  const IMAGE_WORDS = [
    "image", "images", "photo", "photos", "picture", "pictures",
    "图片", "图像", "照片", "影像"
  ];
  const LIBRARY_WORDS = ["library", "资料库", "文件库", "圖庫", "媒體庫"];
  const DELETE_WORDS = ["delete", "remove", "删除", "刪除", "移除"];
  const FILE_WORDS = ["file", "files", "文件", "檔案"];
  const ACCOUNT_WORDS = ["account", "workspace", "chat", "conversation", "账户", "帳戶", "工作区", "工作區", "对话", "對話"];

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function containsAny(text, words) {
    const normalized = normalizeText(text);
    return words.some((word) => normalized.includes(word));
  }

  function accessibleText(element) {
    if (!element) return "";
    return normalizeText([
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("alt"),
      element.textContent
    ].filter(Boolean).join(" "));
  }

  function isLibraryPage(doc) {
    const url = String(doc?.location?.href || "");
    const main = doc?.querySelector?.("main") || doc?.body;
    const headingText = Array.from(main?.querySelectorAll?.("h1,h2,[role='heading']") || [])
      .map(accessibleText)
      .join(" ");
    return /chatgpt\.com$/i.test(doc?.location?.hostname || "") &&
      (/\/library(?:\/|$|\?)/i.test(url) || containsAny(headingText, LIBRARY_WORDS));
  }

  function looksLikeImageItem(element) {
    if (!element) return false;
    const label = accessibleText(element);
    const hasImage = Boolean(element.querySelector("img,video[poster],svg[aria-label*='image' i]"));
    const hasImageExtension = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)(?:\b|$)/i.test(label);
    const explicitlyImage = containsAny(label, IMAGE_WORDS);
    const explicitlyOtherFile = /\.(?:csv|docx?|pdf|pptx?|txt|xlsx?)(?:\b|$)/i.test(label);
    return !explicitlyOtherFile && (hasImage || hasImageExtension || explicitlyImage);
  }

  function findImageItems(doc) {
    if (!doc?.querySelectorAll) return [];
    const root = doc.querySelector("main,[role='main']") || doc;
    const selectors = [
      "[data-testid*='file-card' i]",
      "[data-testid*='library-item' i]",
      "[role='listitem']",
      "[role='row']",
      "tr",
      "article"
    ];
    const candidates = Array.from(root.querySelectorAll(selectors.join(",")));
    const checkboxes = Array.from(root.querySelectorAll(
      "input[type='checkbox'],button[role='checkbox'],[role='checkbox']"
    ));

    for (const checkbox of checkboxes) {
      const semanticItem = checkbox.closest(selectors.join(","));
      if (semanticItem && root.contains(semanticItem)) continue;
      let current = checkbox.parentElement;
      while (current && current !== root) {
        const nestedCheckboxes = current.querySelectorAll(
          "input[type='checkbox'],button[role='checkbox'],[role='checkbox']"
        ).length;
        if (nestedCheckboxes === 1 && looksLikeImageItem(current)) {
          candidates.push(current);
          break;
        }
        if (nestedCheckboxes > 1) break;
        current = current.parentElement;
      }
    }

    const matches = candidates.filter(looksLikeImageItem);
    return Array.from(new Set(matches))
      .filter((item) => !matches.some((other) => other !== item && item.contains(other)));
  }

  function findSafeDeleteDialog(doc) {
    if (!doc?.querySelectorAll) return null;
    const dialogs = Array.from(doc.querySelectorAll("[role='dialog'],dialog[open]"))
      .filter((dialog) => dialog.offsetParent !== null || !Object.prototype.hasOwnProperty.call(dialog, "offsetParent"));
    if (dialogs.length !== 1) return null;

    const dialog = dialogs[0];
    const text = accessibleText(dialog);
    if (!containsAny(text, DELETE_WORDS) ||
        (!containsAny(text, IMAGE_WORDS) && !containsAny(text, FILE_WORDS)) ||
        containsAny(text, ACCOUNT_WORDS)) {
      return null;
    }

    const buttons = Array.from(dialog.querySelectorAll("button,[role='button']"));
    const confirmButtons = buttons.filter((button) => {
      const label = accessibleText(button);
      return containsAny(label, DELETE_WORDS) && !/cancel|取消|返回/.test(label);
    });
    if (confirmButtons.length !== 1) return null;
    return { dialog, confirmButton: confirmButtons[0] };
  }

  scope.ChatGPTImageCleanerDOM = Object.freeze({
    accessibleText,
    findImageItems,
    findSafeDeleteDialog,
    isLibraryPage,
    looksLikeImageItem,
    normalizeText
  });
})(globalThis);
