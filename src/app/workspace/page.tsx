'use client'

import styles from './workspacePage.module.scss'
import { ArrowRight, FileText, List, Plus, Settings, Loader2, FolderOpen } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { nanoid } from 'nanoid'
import { addData } from '@/utils/storage/db'
import { useState } from 'react'
import useStyleStore from '@/app/store/useStyleStore'
import { useUserStore } from '../store/useUserStore'
import useListStore from '../store/useListStore'
import { toast } from '@/components/Toast'

const WorkspacePage = () => {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const dataList = useListStore(state => state.dataList)
  const isLoading = useListStore(state => state.isLoading)
  const recentDocs = dataList.flatMap(group => group.dataList).slice(0, 5)
  const totalDocs = dataList.reduce((count, group) => count + group.dataList.length, 0)
  const userName = useUserStore(state => state.name)
  const isLogin = useUserStore(state => state.isLogin)
  const toggleModalOpen = useStyleStore(state => state.toggleModalOpen)

  const handleCreate = async () => {
    if (isCreating) return
    setIsCreating(true)
    try {
      const id = nanoid()
      if (isLogin) {
        const response = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: id }),
        })
        const result = await response.json()
        if (!response.ok || !result.success) throw new Error(result.error || '创建文档失败')
      }
      await addData('未命名新文档', id)
      router.push(`/workspace/${id}`)
    } catch (error) {
      console.error('创建文档失败:', error)
      toast.show('创建文档失败，请稍后重试')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>你的创作空间</p>
          <h1>工作区</h1>
          <p className={styles.subtitle}>欢迎回来{userName ? `，${userName}` : ''}。从这里继续你的想法。</p>
          <div className={styles.summary}>
            <span>{isLoading ? '正在读取文档…' : `共 ${totalDocs} 份文档`}</span>
            <span>{isLogin ? '已登录 · 支持云端协作' : '本地工作区 · 无需登录即可编辑'}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.primaryButton} onClick={handleCreate} disabled={isCreating}>
            {isCreating ? <Loader2 size={18} className={styles.spinner} aria-hidden /> : <Plus size={18} aria-hidden />}
            {isCreating ? '创建中…' : '新建文档'}
          </button>
        </div>
      </header>

      <section className={styles.recentSection} aria-labelledby="recent-heading" aria-busy={isLoading}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="recent-heading">最近创建</h2>
            <p>文档和白板，都在同一个空间里。</p>
          </div>
          <Link href="/workspace/all" className={styles.viewAll}>查看全部 <ArrowRight size={16} aria-hidden /></Link>
        </div>
        {isLoading && recentDocs.length === 0 ? (
          <div className={styles.emptyState} role="status"><Loader2 size={24} className={styles.spinner} aria-hidden /><p>正在读取你的文档…</p></div>
        ) : recentDocs.length > 0 ? (
          <div className={styles.recentList}>
            {recentDocs.map(item => (
              <Link href={`/workspace/${item.id}`} key={item.id} className={styles.recentItem}>
                <span className={styles.documentIcon}><FileText size={22} aria-hidden /></span>
                <span className={styles.documentContent}>
                  <span className={styles.documentTitle}>{item.title || '未命名文档'}</span>
                  <span className={styles.documentDate}>创建于 {new Date(item.createAt).toLocaleDateString('zh-CN')}</span>
                </span>
                <ArrowRight size={18} className={styles.openIcon} aria-hidden />
              </Link>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <FolderOpen size={36} aria-hidden />
            <h3>从第一份文档开始</h3>
            <p>记录文字，或切换白板展开想法。</p>
            <button className={styles.primaryButton} onClick={handleCreate} disabled={isCreating}>{isCreating ? '创建中…' : '新建文档'}</button>
          </div>
        )}
      </section>

      <section className={styles.quickActions} aria-labelledby="actions-heading">
        <h2 id="actions-heading">快速开始</h2>
        <div className={styles.actionGrid}>
          <button className={styles.actionCard} onClick={handleCreate} disabled={isCreating}>
            <Plus size={22} aria-hidden /><span><strong>{isCreating ? '创建中…' : '新建文档'}</strong><small>写下想法，随时切换白板</small></span>
          </button>
          <Link className={styles.actionCard} href="/workspace/all">
            <List size={22} aria-hidden /><span><strong>浏览文档</strong><small>查找文档或加入协作房间</small></span>
          </Link>
          <button className={styles.actionCard} onClick={() => toggleModalOpen('SETTINGS')}>
            <Settings size={22} aria-hidden /><span><strong>工作区设置</strong><small>调整外观与管理账户</small></span>
          </button>
        </div>
      </section>
    </div>
  )
}

export default WorkspacePage
