import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";


export async function POST (request: NextRequest) {
    try {
        const { userId, roomId, checkRoom } = await request.json()
        
        // 检查房间是否存在
        if (checkRoom) {
            const document = await prisma.document.findUnique({
                where: {
                    roomId
                }
            })
            
            if (document) {
                return NextResponse.json({ 
                    success: true, 
                    data: document 
                })
            } else {
                return NextResponse.json(
                    { success: false, error: "房间不存在" }, 
                    { status: 404 }
                );
            }
        }
        
        // 创建新文档
        const newDocument = await prisma.document.create({
            data: {
                title: '未命名新文档',
                roomId: roomId,
                ownerId: userId,
                isPublic: false
            }
        })
        return NextResponse.json({ 
            success: true, 
            data: newDocument 
        })
    }catch (error) {
        return NextResponse.json(
            { success: false, error: "操作失败" + error }, 
            { status: 500 }
        );
    }
}