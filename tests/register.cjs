const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request.startsWith('@/')) request = path.join(__dirname, '..', 'src', request.slice(2));
  return resolve.call(this, request, parent, ...args);
};
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    module._compile(outputText, filename);
  };
}

global.requestAnimationFrame ??= callback => { const timer = setTimeout(() => callback(performance.now()), 16); timer.unref(); return timer; };
global.cancelAnimationFrame ??= timer => clearTimeout(timer);
