'use client'

import { Loader2 } from 'lucide-react'
import styles from './EditorLoading.module.scss'

interface EditorLoadingProps {
  title: string
  description?: string
}

export function EditorLoading({ title, description }: EditorLoadingProps) {
  return (
    <div className={styles.wrap} role="status" aria-live="polite" aria-busy="true">
      <div className={styles.card}>
        <div className={styles.spinnerWrap}>
          <Loader2 className={styles.spinner} size={28} strokeWidth={2.25} aria-hidden />
        </div>
        <h2 className={styles.title}>{title}</h2>
        {description ? <p className={styles.description}>{description}</p> : null}
        <div className={styles.dots} aria-hidden>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </div>
      </div>
    </div>
  )
}
