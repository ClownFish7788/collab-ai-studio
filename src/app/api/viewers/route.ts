import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "../auth/[...nextauth]/route";


/*
    {
       roomId:string
       viewerId:string
    }
*/
export async function POST (request: NextRequest) {
    try {
        const { documentId: roomId, userId: viewerId } = await request.json()
        const session = await getServerSession(authOptions)
        if(!session || !session.user) {
            return NextResponse.json({success: false, error:"用户未登录"}, {status: 401})
        }
        const ownerId = session.user.id
        // 检查房间是否存在
        const targetDoc = await prisma.document.findUnique({
            where: {
                roomId
            },
            include: {
                viewers: true,
                collaborators: true
            }
        })
        if(!targetDoc) {
            return NextResponse.json({success: false, error: '找不到该文档'}, {status: 404})
        }
        const isOwner = targetDoc.ownerId === ownerId
        if(!isOwner) {
            return NextResponse.json({success: false, error: '无权限'}, {status: 403})
        }
        // 检查用户是否已经创建过viewer
        if(targetDoc.viewers.some(viewer => viewer.userId === viewerId)) {
            return NextResponse.json({success: false, error: 'viewer已创建'}, {status: 409})
        }
        // 如果是collaborator则自动降级
        const existingCollaborator = targetDoc.collaborators.find(c => c.userId === viewerId)
        if(existingCollaborator) {
            await prisma.$transaction([
                prisma.collaborator.delete({
                    where: {
                        id: existingCollaborator.id
                    }
                }),
                prisma.viewers.create({
                    data: {
                        documentId: targetDoc.id,
                        userId: viewerId
                    }
                })
            ])
        }else {
            await prisma.viewers.create({
                data: {
                    documentId: targetDoc.id,
                    userId: viewerId
                }
            })
        }
        return NextResponse.json({success: true, message: '邀请成功'}, {status: 200})
    } catch(err) {
        return NextResponse.json({ success: false, error: "邀请失败" + err }, { status: 500 })
    }
}