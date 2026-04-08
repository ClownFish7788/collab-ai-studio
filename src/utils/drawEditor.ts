import { nanoid } from "nanoid"
import { type Editor, type TLGeoShape, toRichText, createShapeId } from "tldraw"
const DOC_TITLE = '文档标题'

const shapeEventMap = new Map<string, (e: any) => void>()

const createDocShape = (
    editor: Editor,
    switchToDoc: () => void
) => {
    // 定义shapeId，保证唯一性
    const shapeId = createShapeId(nanoid())
    // 检查是否存在，若不存在则创建
    const esistingShape = editor.getShape(shapeId)
    if(!esistingShape) {
        editor.createShape<TLGeoShape>({
            id: shapeId,
            type: 'geo', // 使用几何图形
            x: 100, // 初始坐标，可以计算屏幕中心
            y: 100,
            props: {
                geo: 'rectangle',
                w: 200,
                h: 100,
                richText: toRichText(DOC_TITLE), // 显示文档标题
                fill: 'solid',
                color: 'light-blue',
            },
        });
    }
    const handle = (e: any) => {
        if(e.name === 'double_click' && e.target === 'shape') {
            if(e.shape.id === shapeId) {
                switchToDoc()
            }
        }
    }
    const preHandle = shapeEventMap.get(shapeId)
    if(preHandle) {
        editor.removeListener('event', preHandle)
        shapeEventMap.delete(shapeId)
    }
    editor.off('event', handle)
    shapeEventMap.set(shapeId, handle)
}

export { createDocShape }