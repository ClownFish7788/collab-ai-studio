import { Liveblocks } from "@liveblocks/node";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma"

// 1. 初始化 Liveblocks Node 客户端
const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY as string,
});

export async function POST(request: NextRequest) {
  try {
    const { room, user } = await request.json();
    console.log("请求参数", { room, user });
    if (user.id === undefined || user.name === undefined) {
      return new NextResponse("用户信息不完整", { status: 400 });
    }

    // 1.查询 prisma 是否存在 room
    const document = await prisma.document.findUnique({
      where: {
        roomId: room
      },
      include: {
        collaborators: true
      }
    })
    if(!document) {
      return new NextResponse("房间不存在", { status: 404 });
    }
    // 2.检查是否是房主或合作者
    const isOwner = document.ownerId === user.id
    const isCollaborator = document.collaborators.some(collaborator => collaborator.userId === user.id)
    // 3.判断是否能进入文档
    if(!isOwner && !isCollaborator && !document.isPublic) {
      return new NextResponse("无权限访问", { status: 403 });
    }
    const session = liveblocks.prepareSession(user.id, {
      userInfo: {
        name: user.name,
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