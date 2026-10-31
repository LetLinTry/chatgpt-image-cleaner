# Library Row DOM Fix Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the extension discover image files in ChatGPT Library's current table/grid row layout without weakening deletion safety.

**Architecture:** Keep image classification in `src/dom.js`, expand only the candidate-discovery layer to semantic table rows and checkbox-anchored grid rows inside `main`, and leave the existing guarded deletion flow unchanged. Verify with old fixtures plus new regression fixtures, then package only runtime extension files.

**Tech Stack:** Chrome Manifest V3, vanilla JavaScript, Node test runner, JSDOM, shell ZIP validation.

---

### Task 1: Restore the complete test/package baseline

**Files:**
- Copy: `tests/*.test.js`
- Copy: `scripts/package.sh`
- Copy: `package-lock.json`
- Preserve: `test/dom.test.js`

1. Synchronize missing tests and packaging files from the handed-off source directory.
2. Install exact dependencies with `npm ci`.
3. Run `npm test` and confirm the 20 original tests pass while the new row tests fail for image-count assertions.

### Task 2: Recognize current table and grid rows

**Files:**
- Modify: `src/dom.js`
- Test: `test/dom.test.js`
- Test: `tests/dom-fixtures.test.js`

1. Keep candidate search scoped to the Library `main` content.
2. Add semantic `tr` and `[role=row]` candidates.
3. Derive bounded grid-row candidates from usable checkbox controls, choosing the nearest row-like ancestor containing a filename while avoiding whole-list containers.
4. Reuse `looksLikeImageItem` so non-image extensions remain excluded.
5. Run the focused DOM tests, then all tests.

### Task 3: Validate and package

**Files:**
- Modify: `manifest.json` version only if needed for the new package.
- Create: `/Users/kavin/Downloads/chatgpt-image-cleaner.zip`

1. Parse `manifest.json` and verify every declared script/resource exists.
2. Run all tests and syntax checks.
3. Build a clean ZIP without tests, dependencies, or planning files.
4. List and inspect the archive, extract it to a temporary directory, parse its manifest, and verify its expected runtime files.
