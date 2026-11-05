# Scheme A acceptance evidence

2026-11-05, isolated worktree codex/tldraw-yjs-scheme-a.

## Baseline
npm test initially failed: missing tests/register.cjs. Restoring that loader is part of the change.
Installed dependencies are reused through a node_modules junction; no installation or lockfile changes.

## Recorded checks
- Record codec: 7/7 Node tests passed after first observing missing behavior failures.
- Shared binding/history: initial 12/12 Node tests passed, using two real TLStores and Y.Docs.
- Initial TypeScript check found that addHistoryInterceptor exists at runtime but is excluded from public types.
  Resolution: use public Store.listen and operation-complete flushing instead of relying on that internal API.
- Production migration, real multiuser browsers and performance have not been exercised.

## Required cases before activation
- Preserve move plus independent color; atomic placement candidates include parent and index.
- No undo entry for remote, initialization or system-origin changes.
- Conflict in one unit blocks an entire multi-record undo; creation plus remote edit also blocks.
- Undo/redo, cancellation and drag boundaries use one document history path.
- Delete/restore same ID, stale offline updates, viewer zero writes and invalid graph recovery.
- Actual network disconnection, IndexedDB reload, cloud-empty/cache-empty distinction.
- Old-client isolation and migration read-back/restore before upgrading online rooms.
