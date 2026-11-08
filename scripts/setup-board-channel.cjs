const fs = require('node:fs')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')

async function setupBoardChannel(client, provider) {
    if (!['sqlite', 'postgres'].includes(provider)) throw new Error('Expected sqlite or postgres')
    const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', provider, 'board-channel.sql'), 'utf8')
    // shortcut: simple additive DDL only; use migrations before adding functions or data rewrites.
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(part => part.trim()).filter(Boolean)) {
        await client.$executeRawUnsafe(statement)
    }
}

module.exports = { setupBoardChannel }
if (require.main === module) {
    const client = new PrismaClient()
    setupBoardChannel(client, process.argv[2]).then(() => console.log('Board channel schema is ready'))
        .catch(error => { console.error('Board channel setup failed:', error.code ?? error.name); process.exitCode = 1 })
        .finally(() => client.$disconnect())
}
