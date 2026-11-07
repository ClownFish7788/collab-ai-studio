# Yjs memory and compaction: primary-source findings

Research date: 2026-11-07. Scope: evidence for the scheme-A memory experiment; no product changes or cloud operations.
Installed versions checked locally: Node v24.14.0, yjs 13.6.30, y-indexeddb 9.0.12, @liveblocks/yjs 3.15.5, tldraw 4.5.3. Dependencies are shared through a junction; none were changed.

## 1. Undo retention and clearing are different from GC

The installed UndoManager marks deleted scoped Items with `keepItem(item, true)`. Stack items hold insertion/deletion ranges and a metadata Map, not a complete document snapshot per step. `clear()` traverses cleared deletions, releases keep flags and empties stacks. It does not scan the entire historical store for GC. `destroy()` unsubscribes listeners; it does not call `clear()`.

Sources: [UndoManager v13.6.30](https://github.com/yjs/yjs/blob/v13.6.30/src/utils/UndoManager.js), installed `node_modules/yjs/src/utils/UndoManager.js` lines 19-46, 250-257, 305-320, 395-399; [public UndoManager API](https://docs.yjs.dev/api/undo-manager).

Transaction cleanup only attempts GC on the current transaction's delete set, respecting `deleted && !keep && gcFilter`. Consequently, clearing existing undo history does not guarantee immediate reclamation of all old retained content. A later empty transaction also does not perform a historical sweep.

Source: [Transaction v13.6.30](https://github.com/yjs/yjs/blob/v13.6.30/src/utils/Transaction.js), installed lines 199-218 and 323-328.

Local assert-based characterization (one Map value replaced 1000 times in one captured step): before clear 11926 encoded bytes; after clear 11926 bytes and zero steps; empty transaction still 11926 bytes. Applying that complete update to a fresh default-GC Doc produced 54 bytes with equal current value and state vector. This demonstrates one concrete workload, not a compression ratio promise.

## 2. Diagnostic explicit GC is exported but low-level

`tryGc` and `createDeleteSetFromStructStore` are exported from the package root and declared in its TypeScript types. The official high-level docs inspected did not document an operational compaction workflow using them. Their arguments expose StructStore/Item internals. Treat them as version-sensitive diagnostic tools, not an approved production maintenance API.

For the installed version, the isolated diagnostic is:

```js
Y.tryGc(Y.createDeleteSetFromStructStore(doc.store), doc.store, doc.gcFilter)
```

`tryGc` also merges adjacent deleted structs and skips still-kept Items. In a second 1000-update characterization: 11919 bytes remained 11919 while undo was retained, and undo still restored `{x:0,y:0}`. With history cleared first, explicit GC reduced 11919 to 47 bytes; current value and state vector remained equal.

Sources: [package exports](https://github.com/yjs/yjs/blob/v13.6.30/src/index.js), [Transaction implementation](https://github.com/yjs/yjs/blob/v13.6.30/src/utils/Transaction.js), installed `dist/src/index.d.ts`, `dist/src/utils/Transaction.d.ts`, `dist/src/utils/DeleteSet.d.ts`. These findings do not establish safety for every shape graph, undo scenario or future dependency version.

## 3. Merging updates, reloading and rebuilding are distinct

`mergeUpdates` combines and deduplicates binary updates without garbage-collecting deleted content. Loading complete updates into a default-GC Y.Doc can discard eligible deleted payloads while retaining structural identities needed by the CRDT. `encodeStateAsUpdate` serializes known structs plus the delete set; it is not merely current visible JSON.

Sources: [Document Updates](https://docs.yjs.dev/api/document-updates), [encoding v13.6.30](https://github.com/yjs/yjs/blob/v13.6.30/src/utils/encoding.js), installed `Doc.js` default `gc=true` and `Transaction.js` cleanup.

Copying current business JSON into brand-new shared trees creates new CRDT structs. Keeping business shape IDs does not preserve internal client/clock identities. Such a rebuild is a document-generation migration, not an equivalent update or ordinary GC. Validate late offline edits/deletes separately and isolate the old generation before activation. GC retaining CRDT metadata should not be conflated with discarding those identities.

Sources: [Yjs CRDT algorithm](https://github.com/yjs/yjs/tree/v13.6.30#yjs-crdt-algorithm), installed README lines 1337-1364; [Y.Doc API](https://docs.yjs.dev/api/y.doc). State-vector equality is a useful diagnostic, not by itself a complete convergence proof.

## 4. IndexedDB already trims its update log

Installed y-indexeddb uses a threshold of 500 stored updates and a 1000 ms debounced store operation. `storeState` reads outstanding updates, adds one complete encoded state, then deletes covered older log records. This reduces log duplication/record count, not necessarily the live Doc's historical retention. Continuous writes can postpone the debounced operation; manual calls and persistence completion must be distinguished.

Source: [y-indexeddb v9.0.12](https://github.com/yjs/y-indexeddb/blob/v9.0.12/src/y-indexeddb.js), installed lines 9, 36-45, 98-120. The implementation's outer `storeState` Promise does not return its nested add/delete chain; an experiment should observe actual IndexedDB completion rather than assume that `await storeState()` alone proves physical trimming has finished.

## 5. Liveblocks cloud compaction is not established by client measurements

The public binary APIs read document state and apply binary updates. Sending a smaller encoding is not a documented replacement/physical-compaction operation. Liveblocks' guide explains that clearing content adds deletion operations; deleting the whole room also deletes its other associated data. Neither is an ordinary compaction strategy for this app.

Sources: [Node API](https://liveblocks.io/docs/api-reference/liveblocks-node), [why Yjs documents cannot be deleted independently](https://liveblocks.io/docs/guides/why-you-cant-delete-yjs-documents), installed provider 3.15.5 forwards updates via `room.updateYDoc`.

No official source inspected guarantees the hosted service's GC schedule, physical rewrite timing or reclaimed byte ratio. Those remain unknown. A client-side reload/GC experiment demonstrates local behavior only; it cannot establish Liveblocks server-side savings. Do not delete rooms or publish rebuilt trees to validate a local hypothesis.

## 6. Node measurement interpretation

`process.memoryUsage()` reports bytes: `heapUsed`/`heapTotal` describe V8 heap; `external` covers native allocations associated with JS; `arrayBuffers` is included in `external`; RSS covers resident process memory, including code/native/JS. Do not add `arrayBuffers` to `external` a second time. RSS is not the retained object size of a document.

`--expose-gc` exposes `globalThis.gc()` for controlled diagnostic collections. Repeated GC after temporary work has returned helps compare retained heap, but does not guarantee RSS returns to its previous value. Use fresh processes, comparable loaded-library baselines and repeated samples. `resourceUsage().maxRSS` is process-wide lifetime high-water RSS in KiB, not one operation's JS peak.

Sources: [Node v24.14.0 process API](https://nodejs.org/download/release/v24.14.0/docs/api/process.html#processmemoryusage), [v24.14.0 --expose-gc](https://nodejs.org/download/release/v24.14.0/docs/api/cli.html#--expose-gc). Serialized Yjs bytes and gzip bytes are storage/transfer metrics, not heap measurements.

## 7. Browser measurement interpretation

The Chromium memory API estimates page memory, including related iframes/workers, and requires a secure cross-origin-isolated document. Detect availability instead of assuming it. Its results are implementation dependent, so compare within the same browser/version. They are estimates, not an exact heap census.

Chrome's first-party article says measurement happens during GC and the Promise can wait; its historical implementation describes a timeout up to roughly 20 seconds. That value is not a stable current API guarantee. The article also warns that legacy `performance.memory` can be misleading when heaps are shared. Use repeated observations, identify whether a figure is retained heap, page estimate or storage, and do not report a post-operation sample as the synchronous peak.

Sources: [Chrome/web.dev memory article](https://web.dev/articles/monitor-total-page-memory-usage), [API reference and security requirements](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory). Browser measurements of the full Editor and Node measurements of a headless Store/binding cover different scopes.

## Implications to carry into the experiment

Measure content growth and update-driven growth separately. Keep baseline shape content, mutation count, operation boundaries and payload sizes controlled. Record retained heap, encoded Doc, storage log bytes, history counts and elapsed processing separately. Compare clear-only, preserved-ID reload/GC and new-tree rebuild; assert business content equivalence and exercise offline sync/undo separately. No fixed threshold or production compression ratio follows from sources alone.

Not performed here: application memory benchmark, actual cloud GC verification, production migration or product changes. Low-level GC and document-generation changes require further correctness tests before any implementation proposal.
