import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "../auth/[...nextauth]/route";

// 避免缓存
export const dynamic = 'force-dynamic'

export async function POST (request: NextRequest) {
    try {
        const { roomId, checkRoom } = await request.json()
        const session = await getServerSession(authOptions)
        if(!session || !session.user) {
            return NextResponse.json({success: false, error:"用户未登录"}, {status: 401})
        }
        const userId = session.user.id
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

export async function GET (request: NextRequest) {
    try {
        const session = await getServerSession(authOptions)
        if(!session) {
            return NextResponse.json({success: false, error:"用户未登录"}, {status: 401})
        }
        const userId = session.user.id
        const { searchParams } = new URL(request.url)
        const scope = searchParams.get('scope') ?? 'owner' // 'owner' / 'all'
        const where = scope === 'all' ? 
        {
          OR: [
            { ownerId: userId },
            { collaborators: { some: { userId } } },
            { viewers: { some: { userId } } },
          ],
        }
      : { ownerId: userId }
        const documents = await prisma.document.findMany({
            where,
            orderBy: { updatedAt: "desc" }
        })
        return NextResponse.json({ success: true, data: documents })
    }catch (err) {
        return NextResponse.json({success:false, error:err}, {status:500})
    }
}