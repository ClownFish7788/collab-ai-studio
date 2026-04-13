import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "../auth/[...nextauth]/route";


export async function POST (request: NextRequest) {
     try {
        const { documentId: roomId, userId: collaboratorId } = await request.json()
        const session = await getServerSession(authOptions)
        if(!session || !session.user) {
            return NextResponse.json({success: false, error:"用户未登录"}, {status: 401})
        }
        const ownerId = session.user.id
        const targetDoc = await prisma.document.findUnique({
            where: {
                roomId
            }
        })
        if(!targetDoc) {
            return NextResponse.json({ success: false, error: "找不到该文档" }, { status: 404 })
        }
        if(targetDoc.ownerId !== ownerId) {
            return NextResponse.json({success: false, error: "用户无权限"}, {status: 403})
        }
        const existingCollaborator = await prisma.collaborator.findUnique({
            where: {
                documentId_userId: {
                    documentId: targetDoc.id,
                    userId: collaboratorId
                }
            }
        })
        if(existingCollaborator) {
            return NextResponse.json({ success: false, error: "该用户已经是协作者了" }, { status: 400 })
        }
        const existingViewer = await prisma.viewers.findUnique({
            where: {
                documentId_userId: {
                    documentId: targetDoc.id,
                    userId: collaboratorId
                }
            }
        })
        if(existingViewer) {
            await prisma.$transaction([
                prisma.viewers.delete({
                    where: {
                        id: existingViewer.id
                    }
                }),
                prisma.collaborator.create({
                    data: {
                        documentId: targetDoc.id,
                        userId: collaboratorId
                    }
                })
            ])
        }else {
            await prisma.collaborator.create({
                data: {
                    documentId: targetDoc.id,
                    userId: collaboratorId
                }
            })
        }
        return NextResponse.json({ success: true, message: "邀请成功" })
     }catch(err) {
        return NextResponse.json({ success: false, error: "邀请失败" + err }, { status: 500 })
     }
}