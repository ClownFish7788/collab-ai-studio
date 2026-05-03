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



💡 亮点一：Local-First（本地优先）双态架构设计
Situation (情境): 协同工具需兼顾未登录用户的“即开即用”试用体验，以及弱网/离线情况下的数据安全。
Task (任务): 设计一套“未登录全本地、登录云端同步”的无缝切换架构。
Action (行动): 剥离本地与云端组件路由，基于 y-indexeddb 拦截底层事件自动创建本地库；用户未登录时利用 IndexedDB 完成全量离线存储，登录并加入房间后，通过 Liveblocks 的状态向量 (State Vector) 自动计算差集并合并数据。
Result (结果): 实现了断网重连后的数据自动同步与零丢失，并完美闭环了无效分享链接的路由拦截与用户引导，极大提升了产品 UX。
💡 亮点二：基于 Yjs (CRDT) 的高性能多人实时协同引擎
Situation (��境): 复杂的白板 (Tldraw) 与富文本 (Tiptap) 协同编辑易产生数据冲突、且全量数据传输会导致网络拥堵。
Task (任务): 实现高并发下的低延迟、无冲突多人编辑及光标追踪。
Action (行动): 引入 CRDT 算法 (Yjs) 配合 Liveblocks WebSocket 服务；将所有的拖拽、输入操作转化为极微小（数十字节）的增量更新 (Delta) 进行广播；针对高频光标位置 (Awareness/Presence)，加入 Throttle (节流) 及数据过滤机制。
Result (结果): 彻底解决多端并发操作导致的数据覆盖冲突，支持多用户同屏流畅编辑，WebSocket 网络带宽开销下降 90% 以上。
💡 亮点三：跨引擎（Tldraw/Yjs/IndexedDB）数据双向绑定机制
Situation (情境): 外部引擎 Tldraw 的原生 Store 与 Yjs 内存相互独立，监听不当极易造成无限死循环或单向数据丢失。
Task (任务): 构建可靠的双向同步与本地持久化闭环。
Action (行动): 订阅 Yjs 的 on("change") 将远端广播应用至视图，同时严格监听 Tldraw Store 变更，通过设置 { source: 'user' } 过滤掉非用户级操作，将本地真实变更反向写入 Yjs 及 IndexedDB；结合 window.beforeunload 强制执行脏数据落盘。
Result (结果): 彻底打通“视图层 -> 内存层 -> 磁盘存储层”，保障了巨型白板在极限操作下（如批量拖拽）的数据精准同步。
💡 亮点四：Next.js 全栈安全鉴权与全局状态解耦
Situation (情境): App Router 下 SSR 鉴权容易导致服务端/客户端水合 (Hydration) 报错，且多层级组件重复获取 Token 会带来性能损耗。
Task (任务): 构建安全防线并实现统一的前端身份状态管理。
Action (行动): 后端利用 NextAuth 重写 JWT Callback 注入真实 userId，并在 Middleware 层拦截恶意 API 请求；前端采用“隐形 AuthSync 组件”一次性获取 Session，并单向下发推入 Zustand (Single Source of Truth)。
Result (结果): 实现 API 接口 100% 鉴权覆盖，杜绝了手动操纵 Cookie 带来的安全隐患，并优雅解决了三方插件修改 DOM 导致的 React 水合报错问题。
💡 亮点五：前端渲染性能与边缘场景优化
Situation (情境): 标题高频输入会导致无效的 API 请求与不必要的 React 重渲染。
Task (任务): 优化文档交互逻辑，降低服务器压力与页面卡顿。
Action (行动): 摒弃繁琐的 DOM Ref 操作，采用“受控组件 + Debounce (防抖)”接管 Input 状态；在组件挂载 (isMounted) 后动态加载 Liveblocks Provider，隔离服务端与浏览器独有的随机计算（如 randomHexColor）。
Result (结果): 彻底消除 Next.js 在客户端渲染过程中的 Hydration Mismatch 警告，大幅降低后端接口 QPS，文档标题输入延迟实现肉眼“0 毫秒”感知的丝滑体验。