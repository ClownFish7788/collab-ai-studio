// Isolated-process retained-memory study; never reads or writes production rooms.
require('./register.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { setImmediate: nextTurn } = require('node:timers/promises');
const Y = require('yjs');
const { HistoryManager } = require('@tldraw/editor');
const { getIndexAbove } = require('@tldraw/utils');
const { shape, store } = require('./tldraw-yjs-fixtures.cjs');
const { createYRecord, decodeYRecord, patchYRecord } = require('../src/utils/collaboration/tldrawYjsRecords');
const { initializeBoardV2, assertBoardV2, BOARD_RECORDS } = require('../src/utils/collaboration/tldrawYjsMigration');
const { bindTldrawYjs } = require('../src/utils/collaboration/bindTldrawYjs');
const { attachTldrawYjsHistory } = require('../src/utils/collaboration/tldrawYjsHistory');

const FRAMES_PER_GESTURE = 60;

function makeDoc(count, records) {
  const doc = new Y.Doc();
  doc.clientID = records ? 100000002 : 100000001;
  initializeBoardV2(doc, store().schema, { allowLegacy: false });
  const root = doc.getMap(BOARD_RECORDS);
  doc.transact(() => {
    if (records) {
      for (const record of Object.values(records)) {
        const current = root.get(record.id);
        if (current) patchYRecord(current, decodeYRecord(current), record);
        else root.set(record.id, createYRecord(record));
      }
    } else {
      let index = 'a1';
      for (let i = 0; i < count; i++) {
        index = getIndexAbove(index);
        const record = { ...shape(), id: `shape:memory-${i}`, index, x: (i % 100) * 120, y: Math.floor(i / 100) * 120 };
        record.props.richText = { type: 'doc', content: [{ type: 'paragraph', content: [{
          type: 'text', text: `Record ${i}: ` + 'collaborative board label '.repeat(3),
        }] }] };
        root.set(record.id, createYRecord(record));
      }
    }
  }, 'memory-fixture');
  return doc;
}

function attach(doc, capture) {
  const value = store();
  assertBoardV2(doc, value.schema);
  const binding = bindTldrawYjs(value, doc.getMap(BOARD_RECORDS));
  if (!capture) binding.undoManager.captureTransaction = () => false;
  const history = new HistoryManager({ store: value });
  let mark = 0;
  const editor = {
    store: value, history,
    complete() { return this; }, getIsReadonly() { return false; },
    undo() { history.undo(); return this; }, redo() { history.redo(); return this; },
    getCanUndo() { return history.getNumUndos() > 0; }, getCanRedo() { return history.getNumRedos() > 0; },
    clearHistory() { history.clear(); return this; },
    markHistoryStoppingPoint(name) { const id = `${name}:${++mark}`; history._mark(id); return id; },
    getMarkIdMatching(name) { return history.getMarkIdMatching(name); },
    bail() { history.bail(); return this; }, bailToMark(id) { history.bailToMark(id); return this; },
    squashToMark(id) { history.squashToMark(id); return this; },
  };
  const detach = attachTldrawYjsHistory(editor, binding, () => { throw Error('unexpected undo conflict'); });
  return { doc, value, binding, editor, history, dispose() {
    detach(); binding.undoManager.clear(); binding.dispose(); history.dispose(); value.dispose(); doc.destroy();
  } };
}

function mutate(context, count, start, end, kind = 'position') {
  for (let frame = start; frame < end; frame++) {
    if (frame % FRAMES_PER_GESTURE === 0) context.editor.markHistoryStoppingPoint('memory-drag');
    const id = `shape:memory-${Math.floor(frame / FRAMES_PER_GESTURE) % count}`;
    const record = context.value.get(id);
    if (kind === 'text') {
      context.value.put([{ ...record, props: { ...record.props, richText: { type: 'doc', content: [{
        type: 'paragraph', content: [{ type: 'text', text: `${String(frame).padStart(7, '0')}:` + 'x'.repeat(2040) }],
      }] } } }]);
    } else context.value.put([{ ...record, x: record.x + 1, y: record.y + 1 }]);
  }
  assert.equal(context.binding.error, null);
  const native = context.history.debug();
  assert.equal(native.undos.length, 0); assert.equal(native.redos.length, 0);
  assert.equal(native.pendingDiff.isEmpty, true);
}

function stats(context) {
  let structs = 0, deletedStructs = 0, keptStructs = 0, footprintEntries = 0, clockUnits = 0, deletedClockUnits = 0, retainedDeletedJsonBytes = 0;
  for (const client of context.doc.store.clients.values()) for (const item of client) {
    structs++; clockUnits += item.length;
    if (item.deleted) { deletedStructs++; deletedClockUnits += item.length; }
    if (item.keep) keptStructs++;
    if (item.deleted && item.keep && Array.isArray(item.content?.arr)) {
      retainedDeletedJsonBytes += Buffer.byteLength(JSON.stringify(item.content.arr));
    }
  }
  for (const item of context.binding.undoManager.undoStack) footprintEntries += item.meta.get('board-footprint')?.size ?? 0;
  const update = Y.encodeStateAsUpdate(context.doc);
  return { records: context.value.allRecords().length, encodedBytes: update.byteLength,
    gzipBytes: gzipSync(update).byteLength,
    logicalJsonBytes: Buffer.byteLength(JSON.stringify(context.value.serialize('document'))),
    structs, deletedStructs, keptStructs, clockUnits, deletedClockUnits, retainedDeletedJsonBytes, footprintEntries,
    undoSteps: context.binding.undoManager.undoStack.length, redoSteps: context.binding.undoManager.redoStack.length };
}

async function collect() {
  await new Promise(resolve => setTimeout(resolve, 25)); // Let the Node RAF shim's pending flush finish.
  await nextTurn(); global.gc(); await nextTurn(); global.gc(); await nextTurn(); global.gc();
  return process.memoryUsage();
}

async function snapshot(context, stage, updates, empty) {
  const values = stats(context);
  const memory = await collect();
  return { stage, updates, ...values, ...memory, retainedHeapAboveEmpty: memory.heapUsed - empty.heapUsed,
    processHighWaterRssBytes: process.resourceUsage().maxRSS * 1024 };
}

function sweep(context) {
  const records = context.value.serialize('document'), vector = Y.encodeStateVector(context.doc);
  const start = performance.now();
  // Diagnostic only: low-level exported Yjs APIs, not a production maintenance recommendation.
  Y.tryGc(Y.createDeleteSetFromStructStore(context.doc.store), context.doc.store, context.doc.gcFilter);
  const ms = performance.now() - start;
  assert.deepEqual(Y.encodeStateVector(context.doc), vector);
  assert.deepEqual(context.value.serialize('document'), records);
  return ms;
}

function replace(context, rebuild) {
  const expected = context.value.serialize('document'), vector = Y.encodeStateVector(context.doc);
  const started = performance.now();
  const doc = rebuild ? makeDoc(0, expected) : new Y.Doc();
  if (!rebuild) Y.applyUpdate(doc, Y.encodeStateAsUpdate(context.doc));
  const next = attach(doc, true);
  assert.deepEqual(next.value.serialize('document'), expected);
  if (!rebuild) assert.deepEqual(Y.encodeStateVector(doc), vector);
  context.dispose();
  return { next, ms: performance.now() - started };
}

function preflight(context) {
  const step = context.binding.undoManager.undoStack.at(-1);
  if (!step) return null;
  const before = process.memoryUsage();
  const start = performance.now();
  assert.equal(context.binding.canReplay(step), true);
  return { ms: performance.now() - start, heapBefore: before.heapUsed,
    heapUncollectedAfter: process.memoryUsage().heapUsed };
}

async function worker(spec) {
  if (!global.gc) throw Error('Worker requires --expose-gc');
  const warm = attach(makeDoc(10), true); mutate(warm, 10, 0, 120); warm.dispose();
  const empty = await collect();
  let context = attach(makeDoc(spec.shapes), spec.capture);
  const stages = [await snapshot(context, 'loaded', 0, empty)];
  const points = [1000, 5000, 15000, spec.updates].filter((n, i, all) => n > 0 && n <= spec.updates && all.indexOf(n) === i).sort((a, b) => a - b);
  let completed = 0;
  const started = performance.now();
  for (const point of points) {
    mutate(context, spec.shapes, completed, point, spec.kind); completed = point;
    assert.equal(context.binding.undoManager.undoStack.length, spec.capture ? Math.ceil(point / FRAMES_PER_GESTURE) : 0);
    stages.push(await snapshot(context, `edited-${point}`, point, empty));
  }
  const timings = { editAndMeasurementMs: performance.now() - started };
  if (spec.updates) {
    timings.sweepWithHistoryMs = sweep(context);
    stages.push(await snapshot(context, 'sweep-retaining-history', completed, empty));
    timings.undoPreflight = preflight(context);
    stages.push(await snapshot(context, 'after-undo-preflight', completed, empty));
    context.editor.clearHistory();
    stages.push(await snapshot(context, 'history-cleared', completed, empty));
    timings.sweepWithoutHistoryMs = sweep(context);
    stages.push(await snapshot(context, 'sweep-after-clear', completed, empty));
    let result = replace(context, false); context = result.next; result.next = null;
    timings.reloadPreservingIdsMs = result.ms;
    stages.push(await snapshot(context, 'reload-gc', completed, empty));
    result = replace(context, true); context = result.next; result.next = null;
    timings.rebuildNewIdsMs = result.ms;
    stages.push(await snapshot(context, 'rebuilt-new-ids', completed, empty));
  }
  context.dispose(); context = null;
  const released = await collect();
  return { ...spec, framesPerGesture: FRAMES_PER_GESTURE, empty, stages, timings, released };
}

async function main() {
  if (process.argv[2] === '--worker') {
    console.log(JSON.stringify(await worker(JSON.parse(process.argv[3]))));
    return;
  }
  const textMode = process.argv[2] === '--text';
  const output = path.resolve((textMode ? process.argv[3] : process.argv[2])
    ?? `docs/collaboration/tldraw-yjs-memory-${textMode ? 'text' : 'node'}-results.json`);
  const results = [];
  const report = { generatedAt: new Date().toISOString(), sourceSha256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'), environment: { node: process.version,
    v8: process.versions.v8, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length, systemMemoryBytes: os.totalmem(), yjs: require('yjs/package.json').version,
    tldraw: JSON.parse(fs.readFileSync(path.join(__dirname, '../node_modules/tldraw/package.json'), 'utf8')).version },
  method: `Fresh process per run; 25ms settle and 3 forced V8 GC passes per sample; one real Store/Doc/binding/native recorder adapter; no DOM, providers or IndexedDB; 60 ${textMode ? '2048-byte text replacements' : 'position updates'} per gesture; 3 repeats.`, results };
  const workloads = textMode ? [[3000, true], [3000, false]] : [[0, true], [30000, true], [30000, false]];
  for (let repeat = 1; repeat <= 3; repeat++) for (const shapes of [100, 4000]) {
    for (const [updates, capture] of workloads) {
      const spec = { shapes, updates, capture, repeat, kind: textMode ? 'text' : 'position' };
      const child = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=2048', __filename, '--worker', JSON.stringify(spec)],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 240000 });
      if (child.status !== 0) throw Error(`Failed ${JSON.stringify(spec)}: ${child.stderr}\n${child.stdout}`);
      const result = JSON.parse(child.stdout.trim()); results.push(result);
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
      const loaded = result.stages[0], edited = result.stages.find(s => s.stage === `edited-${updates}`) ?? loaded;
      console.log(JSON.stringify({ ...spec, heapGrowthMiB: +((edited.heapUsed - loaded.heapUsed) / 1048576).toFixed(3),
        encodedBytes: edited.encodedBytes, ms: Math.round(result.timings.editAndMeasurementMs), completed: results.length, total: workloads.length * 6 }));
    }
  }
  console.log(`Saved ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
