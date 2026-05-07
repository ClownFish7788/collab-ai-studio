import useListStore, { groupDocsForListStore, ListItem } from "@/app/store/useListStore"
import { useUserStore } from "@/app/store/useUserStore"
import { getList } from "@/utils/db"
import { useEffect } from "react"

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
    const isLogin = useUserStore(state => state.isLogin)
    const initData = useListStore(state => state.initData)
    useEffect(() => {
        const fetchData = async () => {
            let data:ListItem[] = []
            const indexedDB_Data = await getList()
            data.push(...indexedDB_Data)
            if(isLogin) {
                const response = await fetch('/api/documents', {
                    method: "GET",
                    credentials: "include"
                })
                if(response.ok) {
                    const json = await response.json()
                    const onlineData:OnlineData[] = json.data
                    const cleanData = onlineData.map(item => {
                        const {title, id, createdAt} = item
                        return {
                            title,
                            id,
                            createAt: new Date(createdAt)
                        }
                    })
                    data.push(...cleanData)
                }
            }
            data = data.filter((item, i) => i === data.findIndex(it => it.id === item.id))
            initData(groupDocsForListStore(data))
        }
        fetchData()
    }, [isLogin, initData])
}