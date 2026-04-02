'use client'
import Modal from '../Modal'
import styles from './SearchModal.module.scss'
import classNames from 'classnames'
import { useState, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import useListStore, { ListItem } from '@/app/store/useListStore'
import { useParams, useRouter } from 'next/navigation'

interface Props {
    open: boolean,
    closeFn: () => void
    shadow?: boolean
}

const SearchModal = ({open, closeFn, shadow = false}: Props) => {
    const [searchQuery, setSearchQuery] = useState('')
    const dataList = useListStore(state => state.dataList)
    const docList: ListItem[]= dataList.reduce((acc, curr) => acc.concat(curr.dataList), [])

    const params = useParams()
    const router = useRouter()

    // 过滤搜索结果
    const filteredResults = useMemo(() => {
        if (!searchQuery.trim()) return []
        return docList.filter(item => 
            item.title.toLowerCase().includes(searchQuery.toLowerCase())
        )
    }, [searchQuery, docList])

    // 处理搜索输入
    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value)
    }

    // 清除搜索
    const handleClearSearch = () => {
        setSearchQuery('')
    }

    // 处理搜索提交
    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        // 这里可以添加搜索提交逻辑
    }

    return (
        <Modal isOpen={open} shadow={shadow} closeFn={closeFn}>
            <div className={classNames(styles.container)}>
                <form onSubmit={handleSearchSubmit} className={classNames(styles.header)}>
                    <div className={classNames(styles.searchBar)}>
                        <Search size={18} className={classNames(styles.searchIcon)} />
                        <input 
                            type="text" 
                            placeholder='搜索文档和白板...' 
                            className={classNames(styles.inp)} 
                            value={searchQuery}
                            onChange={handleSearchChange}
                            autoFocus
                        />
                        {searchQuery && (
                            <button 
                                type="button" 
                                className={classNames(styles.clearBtn)}
                                onClick={handleClearSearch}
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>
                </form>
                <main className={classNames(styles.main)}>
                    {filteredResults.length > 0 ? (
                        filteredResults.map((item, i) => (
                            <div 
                                key={i} 
                                className={classNames(styles.item)}
                                onClick={() => router.push(`/workspace/${params.userId}/${item.id}`)}    
                            >
                                {item.title}
                            </div>
                        ))
                    ) : searchQuery ? (
                        <div className={classNames(styles.emptyState)}>
                            没有找到匹配的结果
                        </div>
                    ) : (
                        <div className={classNames(styles.emptyState)}>
                            输入关键词开始搜索
                        </div>
                    )}
                </main>
            </div>
        </Modal>
    )
}

export default SearchModal