import { create } from "zustand"

export interface UserInfo {
    name: string
    email: string
    image: string
    id: string
}
interface UserStore extends UserInfo{
    isLogin: boolean
    setIsLogin: (loginState: boolean) => void
    setName: (name: string) => void
    setUserInformation: (userInfo: UserInfo) => void
}

export const useUserStore = create<UserStore>((set) => ({
    isLogin: false,
    name: "",
    email: "",
    image: "",
    id: "",
    setIsLogin: (loginSatae) => set({isLogin: loginSatae}),
    setName: (name) => set({name}),
    setUserInformation: (userInfo) => set({...userInfo})
}))