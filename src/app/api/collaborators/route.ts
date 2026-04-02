import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";


export async function POST (request: NextRequest) {
    const { documentId: roomId, userId } = await request.json()
     try {
        const targetDoc = await prisma.document.findUnique({
            where: {
                roomId
            }
        })
        if(!targetDoc) {
            return NextResponse.json({ success: false, error: "找不到该文档" }, { status: 404 })
        }
        const existingCollaborator = await prisma.collaborator.findUnique({
            where: {
                documentId_userId: {
                    documentId: targetDoc.id,
                    userId
                }
            }
        })
        if(existingCollaborator) {
            return NextResponse.json({ success: false, error: "该用户已经是协作者了" }, { status: 400 })
        }
        await prisma.collaborator.create({
            data: {
                documentId: targetDoc.id,
                userId
            }
        })
        return NextResponse.json({ success: true, message: "邀请成功" })
     }catch(err) {
        return NextResponse.json({ success: false, error: "邀请失败" + err }, { status: 500 })
     }
}