import useListStore, { groupDocsForListStore, ListItem } from "@/app/store/useListStore"
import { useUserStore } from "@/app/store/useUserStore"
import { getList } from "@/utils/storage/db"
import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { toast } from "@/components/Toast"

interface OnlineData {
  id:string
  title:string
  roomId:string
  ownerId: string
  isPublic: boolean
  createdAt: Date | string
  updatedAt: Date | string
}

export const useInitData = () => {
    const pathname = usePathname()
    const isLogin = useUserStore(state => state.isLogin)
    const initData = useListStore(state => state.initData)
    useEffect(() => {
        let cancelled = false
        const controller = new AbortController()
        useListStore.setState({ isLoading: true })
        const fetchData = async () => {
          try {
            let data:ListItem[] = []
            const indexedDB_Data = await getList()
            if (cancelled) return
            data.push(...indexedDB_Data)
            initData(groupDocsForListStore(data))
            if(isLogin) {
              try {
                const response = await fetch('/api/documents', {
                    method: "GET",
                    credentials: "include",
                    signal: controller.signal,
                })
                if (!response.ok) throw new Error('无法读取云端文档')
                if(response.ok) {
                    const json = await response.json()
                    const onlineData:OnlineData[] = json.data
                    const cleanData = onlineData.map(item => {
                        const {title, roomId, createdAt} = item
                        return {
                            title,
                            id: roomId,
                            createAt: new Date(createdAt)
                        }
                    })
                    data.push(...cleanData)
                }
              } catch (error) {
                if (cancelled) return
                console.error('读取云端文档失败:', error)
                toast.show('云端文档暂时无法加载，仍可查看本地文档')
              }
            }
            if (cancelled) return
            data = data.filter((item, i) => i === data.findIndex(it => it.id === item.id))
            initData(groupDocsForListStore(data))
          } catch (error) {
            if (!cancelled) {
              console.error('读取文档失败:', error)
              toast.show('无法读取本地文档，请检查浏览器存储权限后刷新')
            }
          } finally {
            if (!cancelled) useListStore.setState({ isLoading: false })
          }
        }
        fetchData()
        return () => { cancelled = true; controller.abort() }
    }, [isLogin, initData, pathname])
}
