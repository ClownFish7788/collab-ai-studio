import type { Role } from '@/app/store/useEditorStore'

export type RoomValidationResult = {
  success: boolean
  message?: {
    role?: Role
  }
}

export const resolveRoomAccess = (
  authenticated: boolean,
  localDoc: boolean,
  result?: RoomValidationResult
) => {
  if (!authenticated) {
    return { notFound: !localDoc }
  }

  if (!result?.success || !result.message?.role) {
    return { notFound: true }
  }

  return { notFound: false, role: result.message.role }
}
