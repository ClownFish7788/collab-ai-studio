import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const libraries = ['tldraw', '@tldraw/editor', '@tldraw/state', '@tldraw/state-react',
    '@tldraw/store', '@tldraw/utils', '@tldraw/validate', '@tldraw/tlschema', 'yjs']

const config = {
    reactStrictMode: false,
    experimental: { externalDir: true },
    async headers() {
        return [{ source: '/:path*', headers: [
            { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
            { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ] }]
    },
    webpack(config) {
        config.resolve.symlinks = false
        config.resolveLoader.symlinks = false
        // Pin one ESM instance across the worktree's cross-drive node_modules junction.
        for (const library of libraries) {
            const directory = path.join(root, 'node_modules', library)
            const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
            config.resolve.alias[`${library}$`] = path.join(directory, manifest.module)
        }
        return config
    },
}

export default config
