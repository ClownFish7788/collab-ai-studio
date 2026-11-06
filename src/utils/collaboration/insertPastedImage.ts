import { AssetRecordType, createShapeId, type Editor } from 'tldraw'

export function insertPastedImage(editor: Editor, image: { src: string; w: number; h: number; name: string; mimeType: string }) {
    const assetId = AssetRecordType.createId()
    const { x, y } = editor.inputs.getCurrentPagePoint()
    editor.markHistoryStoppingPoint('paste-image')
    try {
        editor.run(() => {
            editor.createAssets([{ id: assetId, type: 'image', typeName: 'asset', meta: {},
                props: { ...image, isAnimated: false } }])
            editor.createShapes([{ id: createShapeId(), type: 'image', x: x - image.w / 2, y: y - image.h / 2,
                props: { assetId, w: image.w, h: image.h } }])
        })
    } finally { editor.markHistoryStoppingPoint('paste-image-end') }
}
