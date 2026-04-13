import prisma from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { NextResponse } from "next/server"
import { authOptions } from "../auth/[...nextauth]/route"


export async function POST (request: Request) {
    try {
        const { title, id } = await request.json()
        const session = await getServerSession(authOptions)
        if(!session || !session.user) {
            return NextResponse.json({success: false, error: "用户未登录"}, {status: 401})
        }
        const userId = session.user.id
        if  (!title || !id) {
            return new NextResponse("标题或id不能为空", { status: 400 })
        }
        const targetDoc = await prisma.document.findUnique({
            where: {roomId: id},
             include: {
                collaborators: true
            }
        })
        const isOwner = targetDoc?.ownerId === userId
        const isCollaborators = targetDoc?.collaborators.some(c => c.userId === userId)
        if(!isOwner && !isCollaborators) {
            return new NextResponse('权限不足' + targetDoc?.ownerId +" " +userId+" " +targetDoc?.collaborators, {status: 403})
        }
        const updateDocument = await prisma.document.update({
            where: {roomId: id},
            data: {
                title
            }
        })
        return NextResponse.json(updateDocument, {status: 200})
    } catch (err) {
        return new NextResponse("更新标题失败原因" + err, {status: 500})
    }
}

export async function GET (request: Request) {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if(!id) {
        return new NextResponse('缺少id', {status: 400})
    }
    try {
        const doc = await prisma.document.findUnique({
            where: {roomId: id}
        })
        return NextResponse.json({title: doc?.title}, {status: 200})
    } catch(err) {
        return new NextResponse("查找错误" + err, {status: 500})
    }

}