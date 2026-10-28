import { CREATE_GEOS, CREATE_COLORS } from '../utils/boardCreateProtocol'

/** 仅由后端提供给模型的工具定义，不包含浏览器执行逻辑。 */
export const boardCreateTool = {
    type: 'function',
    function: {
        name: 'create_shapes',
        description: '在本次临时白板草稿中新增 1～5 个基础图形。ellipse 宽高相等时是圆。x/y 相对任务固定参照点；成功返回真实 ID。不会提交正式白板。',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['shapes'],
            properties: {
                shapes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 5,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['geo', 'x', 'y', 'w', 'h', 'color'],
                        properties: {
                            geo: { type: 'string', enum: CREATE_GEOS },
                            x: { type: 'number', minimum: -10000, maximum: 10000 },
                            y: { type: 'number', minimum: -10000, maximum: 10000 },
                            w: { type: 'number', minimum: 1, maximum: 2000 },
                            h: { type: 'number', minimum: 1, maximum: 2000 },
                            color: { type: 'string', enum: CREATE_COLORS },
                        },
                    },
                },
            },
        },
    },
} as const
