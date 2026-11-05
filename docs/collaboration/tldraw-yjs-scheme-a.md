# tldraw × Yjs scheme A

Status: implementation in isolated worktree, 2026-11-05. Product activation and migration are separate gates.

## Decisions
Yjs remains authoritative. A stable record Y.Map contains a stable props Y.Map.
For shapes, placement={parentId,x,y,rotation,index} is one immutable JSON value.
Only changed keys are written. richText, segments and meta remain atomic JSON values.
Record encoding handles document/page/shape/asset/binding; editor records remain native TLRecord.

## Undo contract (user confirmed)
History is per editor session, using a unique transaction origin.
Only that origin is tracked by Y.UndoManager; network, initialization and migration are excluded.
One conflict anywhere in a captured step blocks the entire undo/redo. There is no partial replay.
A movement conflicts with another placement update, but not with another color update.
Undoing creation conflicts with any received remote edit of that new record.
Received deletion/recreation changes a record's identity boundary and blocks old field replay.
Conflict checking uses per-unit observed remote revisions captured alongside each history step.
It is not a distributed lock: changes not yet received while offline cannot be predicted.
A blocked step stays on the stack, with a user-facing explanation; data is unchanged.
Editor gesture boundaries group dragging; native snapshot undo must not also handle Ctrl+Z.

## Migration and initialization
v1 tl_records is an Array. v2 uses tl_records_v2, never the same root name.
Preserve v1 and backups. Only one controlled initializer/migrator may create default shared trees.
Online cache empty is not evidence that the cloud document is empty.
Old local tabs must close/reload before migration; old clients do not participate in new Web Locks.
Cloud auth changes do not revoke old tokens. Existing online rooms stay gated until old-writer isolation is verified.
AI draft previews remain unsynchronized; approved application uses the existing validated formal-store entry.

## Implementation sequence
1. Record codec and field-delta tests.
2. Shared binding, conflict-aware history and editor integration.
3. Controlled migration/initialization and version gates.
4. Browser, offline, permissions and performance acceptance.

## Validation
See tldraw-yjs-acceptance.md for actual commands and results.
Original design: docs/superpowers/plans/2026-11-04-tldraw-yjs-scheme-a.md (local planning reference).
