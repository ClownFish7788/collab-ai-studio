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
- Run npm test, targeted ESLint, npx tsc --noEmit and git diff --check before completion.
- Keep worktree-local dependencies isolated; node_modules is a junction to the original checkout. Do not reinstall or regenerate shared packages through it.
- Keep ignored scratch in .superpowers; durable handoff and decisions belong in docs/collaboration.
