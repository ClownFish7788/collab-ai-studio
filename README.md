# CollabAI Studio

<div align="center">

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Y.js](https://img.shields.io/badge/Y.js-CRDT-ff6b6b)](https://yjs.dev/)
[![Liveblocks](https://img.shields.io/badge/Liveblocks-realtime-6366f1)](https://liveblocks.io/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**多人实时协作在线工作台 · 离线优先 · AI 助手加持**

</div>

---

## 📖 项目简介

**CollabAI Studio** 是一款基于 Web 的多人实时协作平台，支持文档编辑与无限白板两种工作模式，内置 AI 聊天助手，具备完整的离线编辑与断网恢复能力。

- 基于 **Y.js（CRDT）** 实现零冲突并发编辑，任意多人同时修改同一内容均可自动合并
- 采用 **IndexedDB 离线优先** 架构，断网后仍可正常新建、编辑文档，联网后自动同步
- 双模式编辑器：富文本块级文档（Tiptap）+ 无限画布白板（TLDraw）
- **NextAuth** 登录鉴权，**Prisma + SQLite** 持久化存储

---

## ✨ 功能特性

### 🤝 实时协作
- 基于 Y.js CRDT 算法，多人并发编辑零冲突自动合并
- Liveblocks 实时网络广播，多端光标位置实时可见
- 白板模式批量元素移动采用"相对增量"协议，广播量降至 O(1)，多人协作流畅不卡顿

### 📄 文档模式（Tiptap）
- 块级编辑，支持 H1 / H2 / H3、列表、代码块、引用、动态卡片
- 完整 Markdown 语法支持
- 多人光标实时同步（基于 y-tiptap 底层自定义实现）

### 🎨 白板模式（TLDraw）
- 无限画布，Canvas + React 混合渲染，性能优先
- 内置框选、连线、箭头、图片缩放旋转等交互
- 自定义形状组件（AffineCard）嵌入 React 组件
- 智能图片粘贴：自动识别网络 URL / 本地图片，兼容防盗链与跨域场景

### 📡 离线优先 & 多 Tab 同步
- IndexedDB 三库设计（`doc` / `editor` / `list`），断网可完整使用
- 自研 `BroadcastChannelProvider`，多标签页本地数据实时同步
- 联网后自动恢复：本地数据覆盖内存 → Liveblocks 增量上传

### 🤖 AI 助手
- 右侧可拉伸 AI 聊天框，随时唤出，可隐藏

### 📤 导出
- 支持导出为 PDF、图片、Word 格式

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/ClownFish7788/collab-ai-studio.git
cd collab-ai-studio

# 2. 安装依赖
npm install

# 3. 配置环境变量（复制示例文件后填入相应 Key）
cp .env.example .env.local
# 需要填写：DATABASE_URL、NEXTAUTH_SECRET、LIVEBLOCKS_SECRET_KEY 等

# 4. 初始化数据库
npx prisma migrate dev --name init

# 5. 启动开发服务器
npm run dev
```

打开浏览器访问 [http://localhost:3000](http://localhost:3000)

### 构建生产版本

```bash
npm run build
npm start
```

---

## 📁 项目结构

```
collab-ai-studio/
├── prisma/
│   ├── schema.prisma          # 数据库模型（User / Document / Collaborator）
│   └── migrations/            # 数据库迁移历史
├── src/
│   ├── app/
│   │   ├── page.tsx           # 登录 / 首页
│   │   ├── layout.tsx         # 全局布局
│   │   ├── api/               # Next.js API Routes（NextAuth、Liveblocks、上传等）
│   │   └── workspace/
│   │       ├── layout.tsx     # 工作台布局
│   │       ├── all/           # 全部文档列表页
│   │       └── [workId]/
│   │           └── page.tsx   # 工作区页面（?mode=page 文档 / ?mode=edgeless 白板）
│   ├── components/
│   │   ├── Editor/            # TLDraw 无限画布编辑器
│   │   ├── File/              # 文档视图（Tiptap 富文本）
│   │   ├── FontBar/           # 文档工具栏（样式选择）
│   │   ├── ToolBar/           # 底部工具栏
│   │   ├── Switch/            # 文档 / 白板双模式切换
│   │   ├── AIChat/            # AI 聊天侧边栏
│   │   ├── NavigationBar/     # 左侧资源导航栏
│   │   ├── NetworkStatus/     # 网络状态指示
│   │   ├── provider/          # Liveblocks / Auth 等 Provider 封装
│   │   └── ...
│   ├── hooks/                 # 自定义 Hooks（useYjsStore、usePasteImageToTldraw 等）
│   ├── lib/                   # 工具库（Prisma 客户端、IndexedDB 封装等）
│   └── utils/                 # 通用工具函数
├── types/                     # 全局 TypeScript 类型定义
├── public/                    # 静态资源
├── next.config.ts
├── tsconfig.json
└── package.json
```

---

## 🛠️ 技术栈

| 层次 | 技术 |
|------|------|
| 框架 | Next.js 16 · React 19 · TypeScript 5 |
| 文档编辑器 | Tiptap（ProseMirror） |
| 白板引擎 | TLDraw |
| 实时协作 | Y.js（CRDT）· Liveblocks · @liveblocks/yjs |
| 离线存储 | IndexedDB（idb）· y-indexeddb · BroadcastChannel |
| 状态管理 | Zustand |
| 鉴权 | NextAuth v4 |
| 数据库 | Prisma · SQLite |
| 样式 | Sass / SCSS |