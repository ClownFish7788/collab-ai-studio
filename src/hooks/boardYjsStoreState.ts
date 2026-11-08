import type { TLStoreWithStatus } from 'tldraw'
import type { TldrawYjsBinding } from '@/utils/collaboration/bindTldrawYjs'

export type BoardYjsStoreState = TLStoreWithStatus & { binding?: TldrawYjsBinding; readOnly?: boolean }
