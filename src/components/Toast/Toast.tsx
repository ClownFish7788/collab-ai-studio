'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './toast.module.scss'

type ToastAnim = 'in' | 'out'

interface ToastPayload {
  message: string
  anim: ToastAnim
}

const EXIT_MS = 340

let showImpl: ((message: string) => void) | null = null

/** 全局调用：需在布局中挂载 `<ToastHost />` */
export const toast = {
  show(message: string) {
    showImpl?.(message)
  },
}

export function ToastHost() {
  const [payload, setPayload] = useState<ToastPayload | null>(null)
  const [toastKey, setToastKey] = useState(0)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRef = useRef(0)

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const showInternal = useCallback(
    (message: string) => {
      generationRef.current += 1
      const gen = generationRef.current
      clearHideTimer()
      setToastKey((k) => k + 1)
      setPayload({ message, anim: 'in' })
      hideTimerRef.current = setTimeout(() => {
        if (generationRef.current !== gen) return
        setPayload((prev) => (prev ? { ...prev, anim: 'out' } : null))
      }, 2000)
    },
    [clearHideTimer]
  )

  useEffect(() => {
    showImpl = showInternal
    return () => {
      showImpl = null
      clearHideTimer()
    }
  }, [showInternal, clearHideTimer])

  useEffect(() => {
    if (!payload || payload.anim !== 'out') return
    const gen = generationRef.current
    const t = setTimeout(() => {
      if (generationRef.current === gen) {
        setPayload(null)
      }
    }, EXIT_MS)
    return () => clearTimeout(t)
  }, [payload])

  if (typeof document === 'undefined') return null
  if (!payload) return null

  const node = (
    <div
      key={toastKey}
      className={`${styles.root} ${payload.anim === 'in' ? styles.slideIn : styles.slideOut}`}
      role="status"
      aria-live="polite"
    >
      <p className={styles.message}>{payload.message}</p>
    </div>
  )

  return createPortal(node, document.body)
}
