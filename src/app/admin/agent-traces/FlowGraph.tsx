'use client'

import { useId } from 'react'
import { statusLabels, type FlowNode } from '@/utils/agent-traces/flow'
import styles from './page.module.scss'

export default function FlowGraph({ nodes, selected, onSelect }: {
    nodes: FlowNode[]; selected: string; onSelect: (id: string) => void
}) {
    const markerId = useId().replaceAll(':', '')
    const positions = nodes.map((node, index) => ({ x: node.kind === 'model' ? 50 : node.kind === 'tool' ? 360 : node.kind === 'validation' ? 670 : 360, y: 34 + index * 124 }))
    return <div className={styles.graph} aria-label="运行流程图，可滚动并点击节点查看详情">
        <svg viewBox={`0 0 960 ${nodes.length * 124 + 30}`} role="group" aria-label="Agent 实际执行路径">
            <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
            {positions.slice(1).map((point, index) => {
                const previous = positions[index]
                const middle = (previous.y + 76 + point.y) / 2
                return <path key={nodes[index + 1].id} className={styles.edge} d={`M ${previous.x + 110} ${previous.y + 76} V ${middle} H ${point.x + 110} V ${point.y - 3}`} fill="none" markerEnd={`url(#${markerId})`} />
            })}
            {nodes.map((node, index) => {
                const { x, y } = positions[index]
                return <g key={node.id} transform={`translate(${x},${y})`} className={styles.node} data-kind={node.kind} data-status={node.status}
                    role="button" tabIndex={0} aria-pressed={selected === node.id} aria-label={`${index + 1}. ${node.label}，${statusLabels[node.status] ?? node.status}`}
                    onClick={() => onSelect(node.id)} onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.id) }
                    }}>
                    <title>{node.label} · {statusLabels[node.status] ?? node.status}</title>
                    {node.kind === 'validation'
                        ? <polygon points="24,0 196,0 220,38 196,76 24,76 0,38" />
                        : <rect width="220" height="76" rx={node.kind === 'input' || node.kind === 'result' ? 36 : 10} />}
                    <text x="110" y="31" textAnchor="middle" className={styles.nodeTitle}>{node.label}</text>
                    <text x="110" y="53" textAnchor="middle" className={styles.nodeCaption}>{statusLabels[node.status] ?? node.status}{node.durationMs != null ? ` · ${node.durationMs} ms` : ''}</text>
                </g>
            })}
        </svg>
    </div>
}
