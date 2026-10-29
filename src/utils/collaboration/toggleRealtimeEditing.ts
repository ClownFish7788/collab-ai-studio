import { LiveblocksYjsProvider } from "@liveblocks/yjs"
import { Awareness } from "y-protocols/awareness"
import CustomBoradcastChannel from "./BoradcastChannelProvider";

type ToggleRealtimeEditing = (
    provider: LiveblocksYjsProvider | null | undefined,
    turnoff: boolean,
    customProvider:CustomBoradcastChannel | null | undefined
) => Promise<void>

interface HackableAwareness extends Awareness {
  _originalSetLocalStateField?: Awareness['setLocalStateField'];
  _originalSetLocalState?: Awareness['setLocalState'];
}

const toggleRealtimeEditing:ToggleRealtimeEditing = async (provider, turnoff, customProvider) => {
    if(!provider) return
    const awareness = provider.awareness as unknown as HackableAwareness
    if(turnoff) {
        console.log("🛑 正在启动物理级断网协议...")
        // 告诉所有人：我要消失
        if(awareness) {
            awareness.setLocalState(null)
        }
        await new Promise(resolve => setTimeout(resolve, 150))
        // 关闭云端
        provider.disconnect()
        if(customProvider) {
            customProvider.destroy()
        }
        // 删除awarenes的广播函数并备份
        if(awareness) {
            if(!awareness._originalSetLocalStateField) {
                awareness._originalSetLocalStateField = awareness.setLocalStateField.bind(awareness)
                awareness._originalSetLocalState = awareness.setLocalState.bind(awareness)
            }
            awareness.setLocalStateField = () => {}
            awareness.setLocalState = () => {}
        }
        console.log("📴 已彻底进入离线单机模式！")
    }else {
        console.log("🌐 正在恢复实时协作...")
        if(awareness._originalSetLocalState && awareness._originalSetLocalStateField) {
            awareness.setLocalState = awareness._originalSetLocalState
            awareness.setLocalStateField = awareness._originalSetLocalStateField
        }
        provider.connect()
        awareness.setLocalStateField('user', { 
            name: "CLownFish", 
            color: '#ff5252' 
        })
    }
}

export default toggleRealtimeEditing