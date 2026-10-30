const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')

const resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) {
    return resolve.call(this, name.startsWith('@/') ? path.join(__dirname, '../src', name.slice(2)) : name, ...args)
}
const load = Module._load
Module._load = function (name, ...args) {
    return name === 'server-only' ? {} : load.call(this, name, ...args)
}
require.extensions['.ts'] = (module, filename) => {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    }, fileName: filename }).outputText, filename)
}
