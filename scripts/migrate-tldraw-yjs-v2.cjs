require('./register-typescript.cjs');
const fs = require('node:fs');
const path = require('node:path');
const Y = require('yjs');
const { createTLSchema } = require('@tldraw/tlschema');
const { initializeBoardV2, assertBoardV2 } = require('../src/utils/collaboration/tldrawYjsMigration');

const doc = new Y.Doc(), readBack = new Y.Doc();
try {
  const args = process.argv.slice(2);
  if (args.length !== 2) throw new Error('用法: node scripts/migrate-tldraw-yjs-v2.cjs input.yjs output.yjs');
  const [input, output] = args.map(value => path.resolve(value));
  Y.applyUpdate(doc, fs.readFileSync(input));
  const schema = createTLSchema();
  const records = initializeBoardV2(doc, schema, { allowLegacy: true });
  const bytes = Y.encodeStateAsUpdate(doc);
  Y.applyUpdate(readBack, bytes);
  assertBoardV2(readBack, schema);
  fs.writeFileSync(output, bytes, { flag: 'wx' });
  console.log(JSON.stringify({ output, records, format: 2, published: false }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  doc.destroy(); readBack.destroy();
}
