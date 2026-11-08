import type { Role } from '@/app/store/useEditorStore'

export type RoomAccessScope = { roomId: string; principal: string; notFound: boolean }

export const matchesRoomAccess = (scope: RoomAccessScope | null, roomId: string, principal: string): boolean =>
    scope?.roomId === roomId && scope.principal === principal

export type RoomValidationResult = {
  success: boolean
  message?: {
    role?: Role
  }
}

// undefined 表示校验失败且无法确认权限；null 表示服务端明确拒绝访问。
export const getConfirmedRoomRole = (status: number, result: RoomValidationResult): Role | undefined => {
  if (status === 401 || status === 403 || status === 404) return null
  const role = result?.message?.role
  if (status === 200 && result?.success && (role === 'owner' || role === 'collaborator' || role === 'viewer')) return role
  return undefined
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
