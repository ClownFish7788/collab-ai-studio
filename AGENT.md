# tldraw / Yjs worktree instructions

Scope: implement scheme A on branch codex/tldraw-yjs-scheme-a.
Before continuing, read docs/collaboration/tldraw-yjs-scheme-a.md and git log/status.

## User decisions
- Keep Yjs, Liveblocks and IndexedDB. Use stable nested Maps and atomic placement.
- Undo/redo belongs to this editor session; remote updates never enter its history.
- If any part of one undo step conflicts with another user's received update, leave the whole step unapplied.
- This includes undoing creation after someone else edits the new shape.
- Independent fields remain independent: undoing movement retains another user's color.
- Commit in small reviewable steps; keep design and acceptance evidence current.

## Implementation
- Keep TLRecord unchanged at the editor boundary. Store placement only once in Yjs.
- Normal updates never recreate missing records. Restore explicitly using a fresh shared tree.
- Use one binding for online/local stores; keep provider/presence and AI draft isolation.
- Preserve old roots and recoverable backups. Online migration requires verified isolation of old writers.
- Distinguish model tests, real browser tests and production migration; report each separately.
- Run targeted ESLint, npx tsc --noEmit and git diff --check before completion.
- Keep worktree-local dependencies isolated; node_modules is a junction to the original checkout. Do not reinstall or regenerate shared packages through it.
- Keep ignored scratch in .superpowers; durable handoff and decisions belong in docs/collaboration.

## Handoff (2026-11-06)
- Implementation and local acceptance are recorded in docs/collaboration/tldraw-yjs-acceptance.md.
- New boards use v2. Existing online v1 boards remain viewable read-only with backup export; do not silently migrate them.
- Conflict guards include record references and full-graph simulation before replay. Keep the earliest remote revision across a gesture and never let Yjs skip into an unchecked older entry.
- Prepare the entire local batch before Yjs mutation; rejected writes restore the Store and must fail AI formal application visibly.
- Persist the exact legacy baseline for reload-time detection. Do not remove it as redundant metadata.
- Keep changes as small independent commits, inspect each staged file list, and do not merge or push without instruction.
- Remaining deployment checks: real Liveblocks multi-device/roles/reconnect, old-token isolation and production migration/recovery; no cloud migration has been performed.

## Native history follow-up (2026-11-07)
- Shared-history attachment stops the native HistoryManager recorder and clears its existing data. Marks belong to the adapter, not the native stack.
- Preserve the native count-query bridge and deferred cache invalidation: UI queries created before onMount must observe shared undo/redo state even after native recording stops.
- The protected history access is compatibility code for tldraw 4.5.3; validate native toolbar and empty native stacks on dependency upgrades.
- The adapter owns history for the Editor lifetime. Detaching does not restart native recording; create a new Editor to return to native history.
- Yjs history limits and document compaction remain separate work; stopping native recording does not bound Yjs memory.

## Memory research (2026-11-07)
- Before implementing history limits or compaction, read docs/collaboration/tldraw-yjs-memory-study.md and its linked raw results. This research changed no product policy; proposed limits and idle timing remain candidates.
- Compare retained heap, encoded bytes and browser whole-page memory separately. Historical measurements remain in the local docs/collaboration files; benchmark sources were removed with the test suite.
- Preserve CRDT identity and reachable undo/redo data during reclamation. Fresh-tree reconstruction is a migration boundary; cloud physical reclamation remains unverified.
