import { create } from "zustand";

type Status = "initial" | "connecting" | "connected" | "reconnecting" | "disconnected"

interface NetworkState {
    isOpenNetwork: boolean
    networkStatus: Status
    toggleIsOpenNetwork: (value: boolean) => void
    toggleNetworkStatus: (status:Status) => void
}

const useNetworkStore = create<NetworkState>((set) => ({
    isOpenNetwork: true,
    networkStatus: 'initial',
    toggleIsOpenNetwork: (value) => set({
        isOpenNetwork: value
    }),
    toggleNetworkStatus: (status) => set({networkStatus: status})
}))

export default useNetworkStore