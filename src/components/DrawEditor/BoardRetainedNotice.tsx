import { useValue } from 'tldraw'
import type { TldrawYjsBinding } from '@/utils/collaboration/bindTldrawYjs'

export function BoardRetainedNotice({ binding }: { binding?: TldrawYjsBinding }) {
    const count = useValue('retained-board-records', () => binding?.retainedRecords.get().length ?? 0, [binding])
    if (!count) return null
    return <div role="status">有 {count} 个对象因相关内容的引用而保留，相关内容移除后会自动隐藏。</div>
}
