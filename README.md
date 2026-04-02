CollabAI Studio是一款多人协作的在线工具流，可使用多种工具来进行协作，并带有离线功能，用户可使用自带AI来助力工作效率
1.界面展示
    页面分为左右两栏，左为资源树（导航栏），右为工作区，工作区右侧自带拉伸AI聊天框（可隐藏）
    自带 “双模式切换”，文档视图和白板视图（无限画布）
    带有文件（PDF，图片，WORD）导出和文件下载功能
2.智能文档编辑器
    工作区底部自带编辑器（可向下隐藏），带有 H1/H2/H3,列表，代码块，引用
    动态卡片插入
    块级编辑，每一个元素都是一个块
3.可视化AI工作流
4.实时协同与离线功能
    冲突解决：即使两个人同时修改同一行字，也不会互相覆盖，而是自动合并（基于 CRDT 算法）
    离线编辑：拔掉网线，依然可以新建文档、编辑工作流。数据保存在浏览器本地（IndexedDB）

src
|   app
|   |   page
|   |   layout
|   |   workspace[userId]
|   |   |   all（全部功能页面）
|   |   |   [workId]
|   |   |   |   page(?mode=page/edgeless)   page-文档模式  edgeless-白板模式
|   components
|   |   editor（无限画布）
|   |   toolbar（底部工具栏）
|   |   |   tools
|   |   switch（双模式切换）
|   |   file（文档视图）
|   |   AIChat（AI聊天框）
|   |   navigationBar（左侧导航栏）
|   |   notification（弹框）



文档模式使用Tiptap作为编辑库
    1.Tiptap不携带默认样式和DOM结构，只提供功能逻辑，UI层完全由开发者封装
    2.它相比于其他第三方库更适用于React框架
    3.它基于ProseMirror，稳定性强且更加适合做协同编辑（Tiptap完美支持Y.js）
    4.强大的Markdown支持
Editor作为编辑组件，FontBar作为样式选择组件

白板模式使用TLDraw
    1.性能优化：它内部混合了 Canvas 和 React 渲染
    2.内置交互：框选、删除、连线、箭头、图片的缩放旋转，全部现成的
    3.自定义形状：你可以定义一个 AffineCard 形状，里面放你的 Next.js 组件

使用idb代替原生的indexDB API
    1.设计3个数据库 doc-文档数据 editor-画布数据 list-所有数据的id+title

实时编辑使用liveblocks + Y.js
    tiptap部分(tiptap协同编辑插件基于Y.js)
        tiptap <---> Y.js(CRDT保证数据一致性) <---> liveblocks/yjs(监听数据Y.js数据变化发送网络请求/接收) <---> liveblocks(接收网络请求并广播到同一房间的每个用户)
        光标由于CollaborationCursor版本老旧导致无法兼容，所以使用y-tiptap底层调用并自行封装
    tlDraw部分(将原数据结构转换为Y.js)
        tlDraw <--->Y.js(hooks/useYjsStore转换数据结构) <---> ...(与tiptap一致)
        光标可以考虑 Liveblocks Native Presence (类似游戏服务器的 UDP 数据包优化)

Y.js优势
    1.性能：
        会将多个连续的block合并一个
        在确保所有人都同步后，Y.js会将历史记录真正地从内存中删除
    2.网络无关性
        Y.js只负责将数据，不负责传输数据，Y.js提供了灵活的provider保证可以用各种方式传输数据(Uint8Array 格式的二进制数据)
    3.生态绑定
        Y.js现在已经与主流框架和UI库进行了深度绑定
    4.内置了Awareness(状态感知通道)
        将持久需要保存(y.Doc)的数据和临时性、高频、不需要永久保存的数据(用户光标位置等)进行区分，，避免内存爆炸
        Awareness提供了一套低延迟的广播机制

利用broadcastChannel和y-indexeddb来实现BroadcastChannelProvider工具，在离线状态下广播和监听多tab页的doc数据更改
    y-indexeddb在恢复网络后先进行数据覆盖，再利用liveblocks进行数据上传
    
自定义toggleRealtimeEditing方法取消实时编辑

自定义usePasteImageToTldraw来替代tldraw原生的图片复制功能
    根据复制内容智能配对
        网络图片URL：通过判断URL后缀来进行智能选择是否复制图片，还是建立文本框复制文字
        本地图片：并非直接将图片转换为base64增大Y.js内存导致内存膨胀，而是上传到后端，通过后端返回的url来建立图片
    遇到加载极慢或带有防盗链的外部图片时，tldraw可能会抛出canvas错误，而我通过new Image()来访问图片宽高
    若遇到跨域问题，通过try...catch捕获错误，并放置“图片失效”元素提醒用户

当用户鼠标选中大量元素并移动时，在移动结束前使用“相对增量”
    1.在选中大量元素时通过广播将这些元素的id发送出去
    2.高频(60fps)发送鼠标偏移量
    3.在其他用户的电脑上进行“视觉欺骗”，渲染时根据id在原本的坐标上增加偏移量
    4.当鼠标松开时才做真正的底层数据结算

    
后端 prisma
npx prisma migrate dev --name init
    1.生成物理文件
    2.生成“快照”(历史记录)
    3.触发隐式generate