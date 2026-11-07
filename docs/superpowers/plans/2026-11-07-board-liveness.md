# Board liveness implementation plan

> **For agentic workers:** Execute inline using superpowers:executing-plans and test-driven-development, followed by one independent whole-change review.

**Goal:** Preserve concurrent child content after an unseen parent deletion without rebuilding shared trees or sending repair writes.

**Architecture:** v3 retains stable record/props Maps and a boolean `keep` on each record (not exposed in TLRecord). User history tracks activation, field changes and deactivation; payload materialization is excluded from history. Effective records are explicit live records plus their transitive dependencies. Known conflicts still reject a whole history step; late conflicts retain only required records.

**Tech Stack:** Existing tldraw 4.5.3, Yjs, Liveblocks, IndexedDB; no new packages.

**Spec:** `docs/collaboration/tldraw-yjs-liveness.md`, based on the user's approved discussion and 27 browser reproductions.

## Global constraints
- Retain Yjs, Liveblocks and IndexedDB, original TLRecord boundary and atomic placement.
- Do not implement compaction, history limits or physical reclamation.
- Preserve v1/v2 data; no automatic online migration; new protocol must exclude old writers.
- Do not change the main checkout's unrelated agent edits. Use existing scheme-a worktree.
- No merge/push or cloud mutation. Keep per-session history and permission checks.

## Review focus
- Interrupted materialization cannot reveal inactive payload or place its root insertion in user history.
- Known descendants must still block undo, although projection could retain their ancestors.
- Reload, read-only peers and duplicated/reordered delivery compute the same state without repair writes.
- Live references to retained assets/binding endpoints remain valid; missing payload/cycles still fail validation.
- Old cached formats remain viewable read-only online; migration retains exact baselines and fails on late old writes.

### Task 1: Regression and effective state
- [x] Add `tests/board-liveness.test.cjs`, using the existing TypeScript loader and real TLStore/Y.Doc; observe original missing-parent regression fail.
- [x] Add `src/utils/collaboration/tldrawYjsState.ts`: `recordReferences`, `validateBoardRecords`, `readBoardState` returning `{all, explicit, visible}`. Validate payload identity/schema and keep boolean, derive dependency closure, validate visible graph.
- [x] Update codec to create inactive stable payload and strip keep from TLRecord decoding.
- [x] Verify inactive records, multi-level ancestry, missing references and cycles.

### Task 2: Binding and history
- [x] Exclude payload materialization origin from undo and version counters. Track activation/deactivation in normal user transactions.
- [x] Replace physical removes with keep=false; reuse existing Maps. Use effective state for applying remote data and recovery.
- [x] Extend footprints to treat keep transitions as whole-record/existence boundaries; preserve earliest remote revision.
- [x] In fork replay, reject explicitly deactivated records still needed by known dependencies, then validate effective graph. Preserve one-step isolation.
- [x] Test unseen child in both orders, multi-object partial retention, refresh/closed author, duplicate updates/no repair writes, undo/redo, known conflicts, independent fields, permissions and rejected batches.

### Task 3: v3 lifecycle and protocol
- [x] Rename public migration entrypoints to `initializeBoard`/`assertBoard`, set BOARD_FORMAT=3 and BOARD_RECORDS=tl_records_v3.
- [x] Preserve v1/v2 roots and exact baselines, require explicit offline/local upgrade, reject late old writes. Update CLI converter.
- [x] Wire local/online hooks and previous-format read-only projection, room bootstrap, metadata/auth version and workspace request. Unknown future formats fail closed.
- [x] Add a small retained-content notice backed by a reactive binding atom.
- [x] Test migration roundtrip, malformed flags, old-writer detection, old/new protocol admission and bootstrap readback failure.

### Task 4: Verification and handoff
- [x] Run `node --test tests/board-liveness.test.cjs`, targeted ESLint, `npx tsc --noEmit`, `git diff --check`.
- [x] Re-run real browser Editor + IndexedDB + controlled relay against v3; change old failure expectations to valid parent/child retention and no repair writes. Test refresh and closed author.
- [x] Independent review, fix important findings with regression tests; update design/acceptance docs and report remaining Liveblocks/old-token isolation limits.

Execution ruling: user explicitly approved this design and said to start; proceed inline without requesting another permission checkpoint. Existing test suite was intentionally removed in c7f810a: add only targeted regression coverage, not the deleted suite.

Verification: 29 targeted Node tests and 27 production-browser scenarios passed; typecheck/ESLint passed before final documentation. Independent whole-change review found no blocker; local layout adjustment reuses existing styles. Final checks and local commit follow.
