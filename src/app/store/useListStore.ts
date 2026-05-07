import { create } from "zustand";

export interface ListItem {
    id: string
    title: string
    createAt: Date
}

interface DateItem {
    date: string
    dataList: ListItem[]
}

/** IndexedDB / getList 扁平记录 → initData 所需的按日分组结构 */
export function groupDocsForListStore(
    raw: { id: string; title: string; createAt: Date | string }[]
): DateItem[] {
    const sorted = [...raw].sort(
        (a, b) =>
            new Date(b.createAt).getTime() - new Date(a.createAt).getTime()
    )
    return sorted.reduce<DateItem[]>((res, curr) => {
        const validDate = new Date(curr.createAt)
        const dateStr = `${validDate.getFullYear()}年${validDate.getMonth() + 1}月${validDate.getDate()}日`
        const index = res.findIndex((item) => item.date === dateStr)
        const listItem: ListItem = {
            id: curr.id,
            title: curr.title,
            createAt: validDate,
        }
        if (index === -1) {
            res.push({ date: dateStr, dataList: [listItem] })
        } else {
            res[index].dataList.push(listItem)
        }
        return res
    }, [])
}

interface ListStore {
    dataList: DateItem[]
    addItem: (id: string) => void
    initData: (list: DateItem[]) => void
    getNameById: (id: string) => string|undefined
    getDataNum: () => number
    getItems: (n:number) => ListItem[]
}

const useListStore = create<ListStore>((set, get) => ({
    dataList: [],
    addItem: (id) => {
        const data = get().dataList
        const hasId = data.some(item => item.dataList.some(item => item.id === id))
        if(hasId) return
        const date = new Date()
        const newItem = {
            id,
            title: "title",
            createAt: date
        }
        const dateStr = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
        const index = data.findIndex((item:DateItem) => item.date === dateStr)
        let newDataList:DateItem[] = []
        if (index === -1) {
            // 不存在该日期分组，新增
            newDataList = [
                ...data,
                { date: dateStr, dataList: [newItem] }
            ];
        } else {
            // 存在该日期分组，不可变地添加新项
            newDataList = data.map((group, i) => 
                i === index
                    ? { ...group, dataList: [...group.dataList, newItem] }
                    : group
            );
        }
        set({
            dataList: newDataList
        })
    },
    initData: (list) => {
        const compareFn = (a: ListItem, b: ListItem) => {
            return b.createAt.getTime() - a.createAt.getTime()
        }
        const compareFn_1 = (a: DateItem, b:DateItem) => {
            return b.dataList[0].createAt.getTime() - a.dataList[0].createAt.getTime()
        }
        list.forEach(item => item.dataList.sort(compareFn))
        list.sort(compareFn_1)
        set({dataList: list})
    },
    getNameById: (id) => {
        const dataList = get().dataList
        let title
        for (const dataItem of dataList) {
            const data = dataItem.dataList.find(item => item.id === id)
            if(data) {
                title = data.title
            }
        }
        return title
    },
    getDataNum: () => {
        const data = get().dataList
        let num = 0
        console.log(data)
        data.forEach(item => {
            num += item.dataList.length
            console.log(num)
        })
        return num
    },
    getItems: (n) => {
        const dataList = get().dataList
        const data = []
        for (const item of dataList) {
            const len = item.dataList.length
            if(n - len >= 0) {
                data.push(...item.dataList)
                n -= len
                if(n === 0) break
            } else {
                data.push(...item.dataList.slice(0, n - len))
                break
            }
        }
        return data
    }
}))

export default useListStore