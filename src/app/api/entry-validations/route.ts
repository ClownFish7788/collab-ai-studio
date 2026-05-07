import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "../auth/[...nextauth]/route";



export async function POST (request: NextRequest) {
    try {
        const { roomId } = await request.json()
        const session = await getServerSession(authOptions)
        if(!session || !session.user) {
            return NextResponse.json({success: false, error: "未登录"}, {status: 401})
        }
        const userId = session.user.id
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
            return NextResponse.json({success: false, error: '未找到房间'}, {status: 404})
        }
        const isViewer = targetDoc.viewers.some(v => v.userId === userId)
        const isCollaborator = targetDoc.collaborators.some(c => c.userId === userId)
        const isOwner = targetDoc.ownerId === userId
        if(isOwner) {
            return NextResponse.json({success: true, message: {
                role: 'owner',
                roomId
            }}, {status: 200})
        }else if(isCollaborator) {
            return NextResponse.json({success: true, message: {
                role: 'collaborator',
                roomId
            }}, {status: 200})
        }else if(isViewer || targetDoc.isPublic) {
            return NextResponse.json({success: true, message: {
                role: 'viewer',
                roomId
            }}, {status: 200})
        }else {
            return NextResponse.json({success: false, error: '您无权限'}, {status: 403})
        }
    }catch(err) {
        return NextResponse.json({success: false, error: err}, {
            status: 500
        })
    }
}