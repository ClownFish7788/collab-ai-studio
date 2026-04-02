import * as Y from 'yjs';

class CustomBoradcastChannel {
    private doc: Y.Doc
    private channel: BroadcastChannel
    constructor (roomId: string, doc: Y.Doc) {
        this.doc = doc
        this.channel = new BroadcastChannel(`yjs-room-${roomId}`)
        
        this.doc.on('update', this.onLocalUpdate)
        this.channel.onmessage = this.onMessage
        console.log(`[${roomId}] 🚀 Provider 初始化成功，加入房间: ${roomId}`)
        // 初始化同步
        if(this.channel) {
            this.channel.postMessage({type: "sync-step-1", stateVector: Y.encodeStateVector(this.doc)})
        }
    }
    private onLocalUpdate = (update: Uint8Array, origin: any) => {
        if(origin !== this && this.channel) {
            this.channel.postMessage({type: "update", update})
        }
    }
    private onMessage = (event: MessageEvent) => {
        const data = event.data
        console.log(data)
        switch (data.type) {
            case 'update':
                Y.applyUpdate(this.doc, data.update, this)
                break
            case 'sync-step-1':
                const syncUpdate = Y.encodeStateAsUpdate(this.doc, data.stateVector)
                this.channel.postMessage({type: "sync-step-2", update: syncUpdate})
                break
            case 'sync-step-2':
                Y.applyUpdate(this.doc, data.update, this)
                break
        }
    }
    public destroy = () => {
        this.channel.close()
        this.doc.off('update', this.onLocalUpdate)
        console.log('BoradcastChannelProvider已关闭')
    }
}

export default CustomBoradcastChannel