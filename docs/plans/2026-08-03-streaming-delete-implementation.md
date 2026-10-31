# Streaming Library Delete Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace total-count deletion with a bounded streaming state machine that works with ChatGPT Library virtual lists containing tens of thousands of images.

**Architecture:** The browser adapter reports batch-removal progress independently of visible count and exposes viewport advancement. The cleaner repeatedly deletes visible batches, advances the virtual list when empty, and finishes only after stable empty passes.

**Tech Stack:** Chrome Manifest V3, vanilla JavaScript, Node test runner, JSDOM.

---

### Task 1: Streaming deletion state machine

**Files:**
- Modify: `src/cleaner.js`
- Test: `tests/cleaner.test.js`

1. Add a failing test where every deleted batch is replaced by an equal-sized visible batch.
2. Add a failing test where an empty viewport advances before more images appear.
3. Implement cumulative deletion, empty-pass completion, and bounded no-progress handling.
4. Run focused and complete tests.

### Task 2: Virtual-scroll browser adapter

**Files:**
- Modify: `src/browser-adapter.js`
- Modify: `content.js`
- Test: `tests/browser-adapter.test.js`

1. Add failing tests for selected-node removal with unchanged visible count.
2. Add failing tests for discovering and advancing a nested scrollable container.
3. Implement removal verification and scroll advancement without relying on total row count.
4. Run focused and complete tests.

### Task 3: Honest popup state and packaged release

**Files:**
- Modify: `popup.js`
- Modify: `src/popup-logic.js`
- Modify: `manifest.json`
- Test: `tests/popup-logic.test.js`
- Create: `/Users/kavin/Downloads/chatgpt-image-cleaner-v1.1.0.zip`

1. Replace total-count wording with visible-image/streaming wording.
2. Display cumulative deletion progress without percentage based on a false total.
3. Run all tests, syntax checks, manifest checks, and archive extraction validation.
4. Package runtime files only as version 1.1.0.
