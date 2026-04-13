'use client'

import classNames from "classnames";
import styles from './workspacePage.module.scss'
import { FileText, LayoutGrid, List, Plus, BarChart2, Clock, Settings } from "lucide-react"
import { useRouter } from "next/navigation"
import { nanoid } from "nanoid"
import { addData, getList } from "@/utils/db"
import { useEffect, useState } from "react"
import useStyleStore from "@/app/store/useStyleStore";
import { useUserStore } from "../store/useUserStore";
import Image from "next/image";

const WorkspacePage = () => {
  const router = useRouter()
  const [recentDocs, setRecentDocs] = useState<any[]>([])
  const [stats, setStats] = useState({
    totalDocs: 0,
    totalWhiteboards: 0,
    recentActivity: 0
  })

  // 获取用户名
  const userName = useUserStore(state => state.name)
  const imgUrl = useUserStore(state => state.image)
  // 获取最近文档
  useEffect(() => {
    const fetchRecentDocs = async () => {
      const data = await getList()
      if (!data) return
      
      // 排序并取最近5个
      const sortedData = [...data].sort((a, b) => {
        const dateA = new Date(a.createAt).getTime()
        const dateB = new Date(b.createAt).getTime()
        return dateB - dateA
      })
      
      setRecentDocs(sortedData.slice(0, 5))
      setStats({
        totalDocs: data.length,
        totalWhiteboards: data.filter(item => item.mode === 'edgeless').length,
        recentActivity: Math.min(data.length, 10)
      })
    }
    
    fetchRecentDocs()
  }, [])

  // 新建文档
  const handleCreate = async () => {
    const id = nanoid(8)
    await addData('title', id)
    router.push(`/workspace/${id}`)
  }

  // 导航到文档
  const handleNavigate = (id: string) => {
    router.push(`/workspace/${id}`)
  }

  // 切换设置弹窗状态
  const toggleModalOpen = useStyleStore(state => state.toggleModalOpen)

  return (
    <div className={classNames(styles.container)}>
      {/* 顶栏 */}
      <header className={classNames(styles.header)}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>工作区</h1>
          <span className={styles.subtitle}>
            欢迎回来{userName && (',' + userName)}
            {imgUrl && <Image src={imgUrl} alt="用户头像" width={10} height={10} />}
          </span>
        </div>
        <div className={styles.headerRight}>
          <button className={classNames(styles.btn, styles.primaryBtn)} onClick={handleCreate}>
            <Plus size={16} />
            <span>新建</span>
          </button>
        </div>
      </header>

      {/* 统计信息 */}
      <section className={classNames(styles.statsSection)}>
        <div className={styles.statCard}>
          <BarChart2 size={24} className={styles.statIcon} />
          <div className={styles.statContent}>
            <h3 className={styles.statValue}>{stats.totalDocs}</h3>
            <p className={styles.statLabel}>总文档数</p>
          </div>
        </div>
        <div className={styles.statCard}>
          <LayoutGrid size={24} className={styles.statIcon} />
          <div className={styles.statContent}>
            <h3 className={styles.statValue}>{stats.totalWhiteboards}</h3>
            <p className={styles.statLabel}>白板数</p>
          </div>
        </div>
        <div className={styles.statCard}>
          <Clock size={24} className={styles.statIcon} />
          <div className={styles.statContent}>
            <h3 className={styles.statValue}>{stats.recentActivity}</h3>
            <p className={styles.statLabel}>最近活动</p>
          </div>
        </div>
      </section>

      {/* 最近文档 */}
      <section className={classNames(styles.recentSection)}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>最近文档</h2>
          <button className={styles.viewAllBtn} onClick={() => router.push(`/workspace/all`)}>
            查看全部
          </button>
        </div>
        <div className={styles.recentList}>
          {recentDocs.length > 0 ? (
            recentDocs.map(item => (
              <div key={item.id} className={styles.recentItem} onClick={() => handleNavigate(item.id)}>
                <div className={styles.recentItemLeft}>
                  <FileText size={20} className={styles.recentItemIcon} />
                  <div className={styles.recentItemContent}>
                    <h3 className={styles.recentItemTitle}>{item.title || '未命名文档'}</h3>
                    <p className={styles.recentItemDate}>
                      {new Date(item.createAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                </div>
                <div className={styles.recentItemRight}>
                  {item.mode === 'edgeless' && (
                    <span className={styles.recentItemTag}>白板</span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className={styles.emptyState}>
              <p>暂无最近文档</p>
              <button className={classNames(styles.btn, styles.primaryBtn)} onClick={handleCreate}>
                立即创建
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 快速操作 */}
      <section className={classNames(styles.quickActions)}>
        <h2 className={styles.sectionTitle}>快速操作</h2>
        <div className={styles.actionGrid}>
          <button className={styles.actionCard} onClick={handleCreate}>
            <div className={styles.actionIcon}>
              <Plus size={24} />
            </div>
            <h3 className={styles.actionTitle}>新建</h3>
            <p className={styles.actionDesc}>创建一个新的文档</p>
          </button>
          <button className={styles.actionCard} onClick={() => router.push(`/workspace/all`)}>
            <div className={styles.actionIcon}>
              <List size={24} />
            </div>
            <h3 className={styles.actionTitle}>查看所有文档</h3>
            <p className={styles.actionDesc}>浏览和管理所有文档</p>
          </button>
          <button className={styles.actionCard} onClick={() => toggleModalOpen('SETTINGS')}>
            <div className={styles.actionIcon}>
              <Settings size={24} />
            </div>
            <h3 className={styles.actionTitle}>工作区设置</h3>
            <p className={styles.actionDesc}>管理工作区配置</p>
          </button>
        </div>
      </section>
    </div>
  );
}

export default WorkspacePage