import { Liveblocks } from "@liveblocks/node";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma"
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBoardProtocolFailure } from "@/lib/boardRoomProtocol";

// 1. 初始化 Liveblocks Node 客户端
const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY as string,
});

export async function POST(request: NextRequest) {
  try {
    const { room, boardProtocol } = await request.json();
    if (typeof room !== 'string' || !room.trim()) {
      return NextResponse.json({ error: '房间编号无效' }, { status: 400 });
    }
    const sessionInfo = await getServerSession(authOptions)
    if (!sessionInfo || !sessionInfo.user) {
      return new NextResponse("用户未登录", { status: 401 });
    }
    const userId = sessionInfo.user.id
    const username = sessionInfo.user.name
    // 1.查询 prisma 是否存在 room
    const document = await prisma.document.findUnique({
      where: {
        roomId: room
      },
      include: {
        collaborators: true,
        viewers: true
      }
    })
    if(!document) {
      return new NextResponse("房间不存在", { status: 404 });
    }
    // 2.检查是否是房主或合作者或者观众
    const isOwner = document.ownerId === userId
    const isCollaborator = document.collaborators.some(collaborator => collaborator.userId === userId)
    const isViewer = document.viewers.some(viewer => viewer.userId === userId)
    // 3.判断是否能进入文档
    if(!isOwner && !isCollaborator && !document.isPublic && !isViewer) {
      return new NextResponse("抱歉，您无权访问此文档", { status: 403 });
    }
    const roomInfo = await liveblocks.getRoom(room).catch((error: unknown) => {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null
      throw error
    })
    const protocolFailure = getBoardProtocolFailure(roomInfo?.metadata ?? {}, boardProtocol)
    if (protocolFailure) {
      return NextResponse.json({ error: protocolFailure.message }, { status: protocolFailure.status })
    }
    const session = liveblocks.prepareSession(userId, {
      userInfo: {
        name: username as string,
      }
    })
    if(isOwner || isCollaborator) {
      session.allow(room, session.FULL_ACCESS)
    }else {
      session.allow(room, session.READ_ACCESS)
    }
    const { status, body } = await session.authorize()
    return new NextResponse(body, { status });

  }catch (error) {
    return new NextResponse("鉴权失败" + error, { status: 500 });
  }
}
