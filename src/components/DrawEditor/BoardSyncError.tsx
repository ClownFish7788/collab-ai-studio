export function downloadBoardBackup(backup: () => Uint8Array, roomId: string) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(backup())], { type: 'application/octet-stream' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `board-${roomId.replace(/[^\w-]/g, '_')}-recovery.yjs`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function BoardSyncError({ error, backup, roomId, onUpgrade }: {
    error: Error; backup: () => Uint8Array; roomId: string; onUpgrade?: () => void
}) {
    return <div role="alert">
        <p>{error.message}</p>
        <p>原始数据已保留，可先导出恢复备份。</p>
        <button type="button" onClick={() => downloadBoardBackup(backup, roomId)}>导出恢复备份</button>
        {onUpgrade && <button type="button" onClick={() => {
            if (window.confirm('请先关闭此白板的其他旧窗口。确认已经关闭后再升级，原始数据会保留。')) onUpgrade()
        }}>升级本机旧白板</button>}
    </div>
}
