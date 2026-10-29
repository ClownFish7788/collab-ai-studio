'use client'

import Modal from '../Modal'
import styles from './SearchModal.module.scss'
import { useState, useMemo, useEffect, useRef, type KeyboardEvent } from 'react'
import { Search, X, FileText, ArrowUpRight } from 'lucide-react'
import useListStore from '@/app/store/useListStore'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Props {
    open: boolean
    closeFn: () => void
    shadow?: boolean
}

const SearchModal = ({ open, closeFn, shadow = true }: Props) => {
    const [searchQuery, setSearchQuery] = useState('')
    const dataList = useListStore(state => state.dataList)
    const isLoading = useListStore(state => state.isLoading)
    const router = useRouter()
    const dialogRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const query = searchQuery.trim().toLowerCase()
    const results = useMemo(() => {
        const docs = dataList.flatMap(group => group.dataList)
        return query ? docs.filter(item => (item.title || '未命名文档').toLowerCase().includes(query)) : docs.slice(0, 6)
    }, [query, dataList])

    useEffect(() => {
        if (!open) return
        const previousFocus = document.activeElement
        inputRef.current?.focus()
        return () => {
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected && getComputedStyle(previousFocus).visibility !== 'hidden') {
                previousFocus.focus()
            } else {
                Array.from(document.querySelectorAll<HTMLElement>('[data-navigation-toggle]'))
                    .find(element => getComputedStyle(element).visibility !== 'hidden')?.focus()
            }
        }
    }, [open])

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.stopPropagation()
            closeFn()
        }
        if (event.key !== 'Tab') return
        const elements = dialogRef.current?.querySelectorAll<HTMLElement>('input, button, a[href]')
        if (!elements?.length) return
        const first = elements[0]
        const last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }

    return (
        <Modal isOpen={open} shadow={shadow} closeFn={closeFn}>
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="搜索文档" className={styles.container} onKeyDown={handleKeyDown}>
                <form className={styles.header} onSubmit={event => {
                    event.preventDefault()
                    if (!results[0]) return
                    router.push(`/workspace/${results[0].id}`)
                    closeFn()
                }}>
                    <Search size={20} aria-hidden />
                    <input ref={inputRef} type="search" aria-label="搜索文档和白板" placeholder="搜索文档和白板…" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} />
                    {searchQuery && <button type="button" aria-label="清空搜索" className={styles.iconButton} onClick={() => { setSearchQuery(''); inputRef.current?.focus() }}><X size={16} aria-hidden /></button>}
                    <button type="button" className={styles.iconButton} aria-label="关闭搜索" onClick={closeFn}><X size={20} aria-hidden /></button>
                </form>
                <div className={styles.resultHeading} role="status">{query ? `找到 ${results.length} 份文档` : '最近创建'}</div>
                <div className={styles.main}>
                    {results.length ? results.map(item => (
                        <Link key={item.id} href={`/workspace/${item.id}`} className={styles.item} onClick={closeFn}>
                            <FileText size={20} aria-hidden />
                            <span><strong>{item.title || '未命名文档'}</strong><small>创建于 {new Date(item.createAt).toLocaleDateString('zh-CN')}</small></span>
                            <ArrowUpRight size={16} aria-hidden />
                        </Link>
                    )) : <div className={styles.emptyState}><Search size={28} aria-hidden /><p>{isLoading ? '正在读取文档…' : query ? '没有找到匹配的文档' : '还没有文档'}</p><small>{query ? '试试更短的关键词，或清空搜索。' : '新建文档后，就可以在这里快速找到。'}</small></div>}
                </div>
                <footer className={styles.footer}><span><kbd>Tab</kbd> 选择文档 · <kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer>
            </div>
        </Modal>
    )
}

export default SearchModal
