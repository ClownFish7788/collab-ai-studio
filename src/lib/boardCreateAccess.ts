import { getServerSession } from 'next-auth'
import prisma from './prisma'
import { authOptions } from '../app/api/auth/[...nextauth]/route'
import { canUseBoardCreateAgent, MAX_BOARD_PAYLOAD_BYTES } from '../utils/boardCreateProtocol'

export class CreateAccessError extends Error {
    status: number

    constructor(message: string, status: number) {
        super(message)
        this.status = status
    }
}

export async function requireCreateUser() {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) throw new CreateAccessError('请先登录后使用 AI 新增', 401)
    return session.user.id
}

/** 启动、发工具、继续推理和接收结果均核对数据库权限；不信任客户端角色。 */
export async function requireCreateAccess(roomId: string, userId: string) {
    const document = await prisma.document.findUnique({
        where: { roomId },
        select: { ownerId: true, collaborators: { select: { userId: true } } },
    })

    if (!canUseBoardCreateAgent(document, userId)) {
        throw new CreateAccessError('当前没有该白板的编辑权限', 403)
    }
}

/** 两条 API 共用读取上限，限制实际字节数而非可伪造的请求头。 */
export async function readCreatePayload(request: Request): Promise<unknown> {
    const reader = request.body?.getReader()
    if (!reader) throw new Error('请求不能为空')

    const decoder = new TextDecoder()
    let size = 0
    let body = ''

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        size += value.byteLength
        if (size > MAX_BOARD_PAYLOAD_BYTES) {
            await reader.cancel()
            throw new Error('白板任务请求或结果超过大小上限')
        }

        body += decoder.decode(value, { stream: true })
    }

    return JSON.parse(body + decoder.decode())
}
