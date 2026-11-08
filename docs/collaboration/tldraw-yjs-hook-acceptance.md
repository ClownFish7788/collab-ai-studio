# 实际本地与 Liveblocks Hook 接入验收

日期：2026-11-08。分支 `codex/tldraw-yjs-scheme-a`，实施基点 `49c1568`。这是 [v3 存在意图验收](tldraw-yjs-liveness-acceptance.md) 的接入补查，未合并、推送或执行生产迁移。

## 接入范围

本次页面直接导入方案工作区的 `useLocalYjsStore`、`useOnlineYjsStore`、`attachTldrawYjsHistory` 和 `BoardRetainedNotice`，使用真实 tldraw Editor、IndexedDB、BroadcastChannel 与 LiveblocksYjsProvider。测试页为临时 Next 16.2.1 production build，已编译及完成自身类型检查；没有执行业务项目的 Prisma build 前置步骤，也没有安装依赖。

本地两页使用相同来源和房间，检查实际本地持久化/跨页链路。云端 A/B/只读端分别在 3017/3018/3019，使用不同来源隔离 IndexedDB 和 BroadcastChannel，交换经过真实 Liveblocks 云服务。

仅创建两个默认权限为空的私有测试房间，标记 `7115c0c1`。服务端读取本机已配置的 Liveblocks 凭据，浏览器只收到测试身份的房间授权；未将密钥放入页面、证据或日志。没有写入业务数据库，没有读取或修改既有业务房间。

授权端点使用真实 Liveblocks `prepareSession/authorize` 和生产 `getBoardProtocolFailure`，但测试身份由临时端点指定。它不覆盖业务 NextAuth 登录、Prisma 的房主/协作者/观众关系查询。

## 发现并修复：首次连接时遗漏权限通知

修复前，A 与 B 的首次连接均出现 `connection=connected`、`status=synced-remote`，但合法编辑被拒绝，提示“当前没有白板编辑权限”。B 的创建子元素断言实际失败。手动断开时读取到 `serverCanWrite=true`，重连后能正常编辑。

根因：Liveblocks 的 `self` 权限通知可能晚于连接状态通知。在线 Hook 只在连接状态等依赖变化时读取 `getSelf()`；当时若读到空值，`verifiedWrite` 就不会随稍后的 self 通知更新。

最小修复：在 `useOnlineYjsStore` 用 `useSelf(self => self.canWrite)` 订阅权限，以这个值更新已验证权限。保留原有写前同步校验、`canEdit` 限制及已验证会话的离线编辑行为。未改变撤销、引用保全或数据格式协议。

修复后，新的 A/B 会话无需手动重连即可移动/改色及创建记录，后续三轮独立记录的测试均可正常首次写入。独立只读审查未发现 Critical/Important；检查了实际 Liveblocks self 通知和现有调用方。

## 本地结果

1. A 创建父容器，B 自动读到内容，B 的初始撤销栈为空。
2. A 将 x 从 80 改到 200，B 改红；A 撤销后两页均为 x=80、红色。
3. 刷新 A，父容器和红色保留，撤销/重做栈为空。
4. 预置 v2 IndexedDB 缓存，实际 Hook 报“旧白板需要受控迁移，不能自动升级”。显式点击升级后转为 v3；刷新后仍为 v3，原父容器保留、历史为空。

## 真实云端结果

核心迟到子元素竞态用三组独立记录重复，三轮通过：A 创建父容器 P 并同步给 B → A 通过实际联网开关断开 Room 与本地广播 → B 创建子元素 C → A 未收到 C 时撤销自己的父创建 → A 重连。

- A 离线撤销后：P/C 不显示，原 P payload 保留，`keep=false`。
- 第1、2轮重连：两端 P/C 都显示，P 的 `keep=false`、`retained=1`，父级位置和颜色正确。
- 第3轮：先通过云端 SDK 回读确认 C 已保存；A 撤销后，B 在收到撤销前关闭页面。A 再重连仍能恢复 P/C。无需 B 在线发送补偿。
- 第3轮后在全新来源打开只读用户：从云端加载 P/C，P 仍为 `keep=false`，本端历史为空。

其他实际接入检查：

- B 点击原生工具栏撤销 C 后，两端 P/C 均隐藏，原 P payload 仍保留；原生重做 C 后，两端父子恢复。
- A 重做 P 使其显式存在后，再撤销时已经知道 C，整步拒绝，P/C 都保留，冲突计数增加1。
- A 移动/B 改色，A 撤销保留 B 的红色；B 撤销自己的改色后恢复黑色。
- 只读端的云端 `canWrite=false`。绕过编辑器 UI 直接 `Store.put` 并 flush，被生产 binding 拒绝；文档 revision 不变，云端回读没有越权测试记录。
- v3 房间的新 protocol=2 授权请求返回 HTTP409。
- 真实 v2 房间允许新协议用户以只读方式查看，即使其服务端权限为可写。尝试移动后云端仍是 format2、原 x=80、v3根为空，没有自动迁移。
- 刷新在线 A，云端尚在连接时已由实际 IndexedDB 缓存恢复合法父子，撤销/重做历史为空。随后连上云端，保留提示与父子图形显示正常。

提取的 DOM 指标和云端回读值见 [结构化证据](evidence/2026-11-08-hook-acceptance.json)。这是实际观察值的摘录，不是完整网络抓包。没有将 `revision` 当成跨客户端全局版本号。

测试脚手架、私有房间创建/检查/清理脚本和失败断言保存在本聊天产物 `hook-acceptance`。它们不进入生产路由。测试期间重用已逻辑隐藏的 ID 被按预期拒绝；后续轮次改用独立 ID，没有为测试放宽身份约束。

## 检查与清理

- 修复后 `node --test tests/board-liveness.test.cjs`：29/29通过。
- 方案工作区 TypeScript、在线 Hook 定向 ESLint、`git diff --check` 通过。
- 临时 Next production build 通过。一次省略 `--webpack` 的构建因现有配置使用 webpack 而失败，补上正确参数后通过；未修改生产打包配置。
- 两个私有临时房间核对命名与所有权标记后删除，随后回读均为404。
- 所有本轮测试页面已关闭，三个 localhost 服务已停止，端口无监听；主工作区的临时运行目录移除，源脚手架保留在聊天产物。

## 仍未覆盖

同一台电脑的不同来源不等于不同物理设备。本次没有验证完整业务登录/数据库授权路由、既有会话内的在线权限切换、已签发旧 token 的撤回、生产迁移、大规模隐藏记录加载、长会话性能或压缩/物理回收。上述边界不能用这次通过的 Hook 接入测试替代。
