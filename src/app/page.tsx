import styles from "./page.module.css";
import Link from "next/link";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.badge}>CollabAI Studio</div>
          <h1 className={styles.title}>
            协同文档 + 无限白板 + 离线编辑
          </h1>
          <p className={styles.subtitle}>
            基于 Y.js（CRDT）与 Liveblocks 的实时协同编辑工作区，同时支持 IndexedDB 离线持久化与多标签页同步。
          </p>
          <div className={styles.ctas}>
            <Link className={styles.primary} href="/workspace/dgshajdh">
              进入工作区
            </Link>
            <a className={styles.secondary} href="https://liveblocks.io" target="_blank" rel="noreferrer">
              了解 Liveblocks
            </a>
          </div>
        </section>

        <section className={styles.features}>
          <div className={styles.card}>
            <div className={styles.cardTitle}>双模式</div>
            <div className={styles.cardDesc}>文档（Tiptap）与白板（tldraw）自由切换，覆盖写作与发散创作场景。</div>
          </div>
          <div className={styles.card}>
            <div className={styles.cardTitle}>实时协同</div>
            <div className={styles.cardDesc}>CRDT 保证最终一致性；多人同时编辑同一处内容也能自动合并。</div>
          </div>
          <div className={styles.card}>
            <div className={styles.cardTitle}>离线可用</div>
            <div className={styles.cardDesc}>断网也能编辑，数据落在 IndexedDB；恢复网络后再与云端同步。</div>
          </div>
          <div className={styles.card}>
            <div className={styles.cardTitle}>AI 助手</div>
            <div className={styles.cardDesc}>侧边 AI 聊天框可折叠，辅助写作、整理与生成内容（按项目能力扩展）。</div>
          </div>
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerLine}>
            技术栈：Next.js · React · Y.js · Liveblocks · Tiptap · tldraw · IndexedDB
          </div>
        </footer>
      </main>
    </div>
  );
}
