import {
    AssetRecordType,
    ArrowShapeArrowheadEndStyle,
    ArrowShapeArrowheadStartStyle,
    ArrowShapeKindStyle,

    DefaultColorStyle,
    DefaultDashStyle,
    DefaultFillStyle,
    DefaultFontStyle,
    DefaultHorizontalAlignStyle,

    DefaultLabelColorStyle,
    DefaultSizeStyle,
    DefaultTextAlignStyle,
    DefaultVerticalAlignStyle,

    GeoShapeGeoStyle,
    LineShapeSplineStyle,
    b64Vecs,
    getHashForString,
    toRichText,
    type TLAsset,
} from 'tldraw'

export type ShapePropertyCase = {
    value: unknown
    invalid: unknown
    /** 创建测试对象前合并的前置属性，例如固定宽度文字需要关闭 autoSize。 */
    setup?: Record<string, unknown>
    /** 原生排版派生字段：验证写入被拒绝，再验证原生派生结果。 */
    readonly?: boolean
    note?: string
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

const BOOKMARK_BASE_URL = 'https://example.com/draft-base'

const BOOKMARK_NEXT_URL = 'https://example.com/draft-next'

const IMAGE_BASE_ID = AssetRecordType.createId('draft-test-image-base')

const IMAGE_NEXT_ID = AssetRecordType.createId('draft-test-image-next')

const VIDEO_BASE_ID = AssetRecordType.createId('draft-test-video-base')

const VIDEO_NEXT_ID = AssetRecordType.createId('draft-test-video-next')

// 使用原生 URL 哈希 ID，修改书签 URL 时命中本地资产，避免触发异步元数据请求。
const BOOKMARK_BASE_ID = AssetRecordType.createId(getHashForString(BOOKMARK_BASE_URL))

const BOOKMARK_NEXT_ID = AssetRecordType.createId(getHashForString(BOOKMARK_NEXT_URL))

/** 不依赖上传、第三方图片或视频播放；base/next 可验证同类型资产引用切换。 */
export const TEST_ASSETS: TLAsset[] = [
    {
        id: IMAGE_BASE_ID,
        typeName: 'asset',
        type: 'image',
        meta: {},
        props: {
            w: 1,
            h: 1,
            name: 'local-base.png',
            isAnimated: false,
            mimeType: 'image/png',
            src: PNG,
        }
    },
    {
        id: IMAGE_NEXT_ID,
        typeName: 'asset',
        type: 'image',
        meta: {},
        props: {
            w: 1,
            h: 1,
            name: 'local-next.png',
            isAnimated: false,
            mimeType: 'image/png',
            src: PNG,
        }
    },
    {
        id: VIDEO_BASE_ID,
        typeName: 'asset',
        type: 'video',
        meta: {},
        props: {
            w: 160,
            h: 90,
            name: 'local-base.mp4',
            isAnimated: true,
            mimeType: 'video/mp4',
            src: null,
        }
    },
    {
        id: VIDEO_NEXT_ID,
        typeName: 'asset',
        type: 'video',
        meta: {},
        props: {
            w: 320,
            h: 180,
            name: 'local-next.mp4',
            isAnimated: true,
            mimeType: 'video/mp4',
            src: null,
        }
    },
    {
        id: BOOKMARK_BASE_ID,
        typeName: 'asset',
        type: 'bookmark',
        meta: {},
        props: {
            title: 'Local base',
            description: 'Local bookmark fixture',
            image: '',
            favicon: '',
            src: BOOKMARK_BASE_URL,
        }
    },
    {
        id: BOOKMARK_NEXT_ID,
        typeName: 'asset',
        type: 'bookmark',
        meta: {},
        props: {
            title: 'Local next',
            description: 'Updated local bookmark fixture',
            image: PNG,
            favicon: '',
            src: BOOKMARK_NEXT_URL,
        }
    },
]

const BASE_SEGMENTS = [{
    type: 'free',
    path: b64Vecs.encodePoints([
        {
            x: 0,
            y: 0,
            z: 0.5
        }, {
            x: 80,
            y: 30,
            z: 0.5
        }, {
            x: 150,
            y: 10,
            z: 0.5
        },
    ])
}]

const NEXT_SEGMENTS = [
    {
        type: 'free', path: b64Vecs.encodePoints([{
            x: 0,
            y: 0,
            z: 0.3
        }, {
            x: 80,
            y: 50,
            z: 0.8
        }])
    },
    {
        type: 'straight',
        path: b64Vecs.encodePoints([{
            x: 80,
            y: 50,
            z: 0.8
        }, {
            x: 180,
            y: 0,
            z: 0.5
        }])
    },
]

const BASE_POINTS = {
    a1: {
        id: 'a1',
        index: 'a1',
        x: 0,
        y: 0
    },
    a2: {
        id: 'a2',
        index: 'a2',
        x: 160,
        y: 40
    },
}

/** 每类只提供可安全演示的必要初始属性；其余属性由原生 ShapeUtil 默认值填充。 */
export const BASE_SHAPE_PROPS: Record<string, Record<string, unknown>> = {
    geo: { w: 200, h: 160 },
    text: {
        w: 240,
        autoSize: false,
        richText: toRichText('Base text')
    },
    note: { richText: toRichText('Base note') },
    line: { points: BASE_POINTS },
    arrow: { start: { x: 0, y: 0 }, end: { x: 180, y: 40 } },
    draw: { segments: BASE_SEGMENTS },
    highlight: { segments: BASE_SEGMENTS },
    frame: {
        w: 360,
        h: 240,
        name: 'Base frame'
    },
    group: {},
    bookmark: {
        w: 300,
        url: BOOKMARK_BASE_URL,
        assetId: BOOKMARK_BASE_ID
    },
    embed: {
        w: 300,
        h: 220,
        url: ''
    },
    image: {
        w: 160,
        h: 120,
        assetId: IMAGE_BASE_ID
    },
    video: {
        w: 160,
        h: 90,
        assetId: VIDEO_BASE_ID
    },
}

/** 对照本机 tldraw 4.5.3 的全部 13 类静态 props；group 原生没有 props。 */
export const SHAPE_PROPERTY_CASES: Record<string, Record<string, ShapePropertyCase>> = {
    geo: {
        geo: { value: 'ellipse', invalid: 'unsupported-geo' },
        dash: { value: 'dashed', invalid: 'unsupported-dash' },
        url: { value: 'https://example.com/geo', invalid: 'javascript:alert(1)' },
        w: { value: 280, invalid: 0 },
        h: { value: 210, invalid: 0 },
        growY: {
            value: 70,
            invalid: -1,
            readonly: true,
            note: '标签排版派生的额外高度。'
        },
        scale: { value: 1.25, invalid: 0 },
        labelColor: { value: 'blue', invalid: 'unsupported-color' },
        color: { value: 'red', invalid: 'unsupported-color' },
        fill: { value: 'solid', invalid: 'unsupported-fill' },
        size: { value: 'l', invalid: 'unsupported-size' },
        font: { value: 'sans', invalid: 'unsupported-font' },
        align: { value: 'start', invalid: 'unsupported-align' },
        verticalAlign: { value: 'end', invalid: 'unsupported-align' },
        richText: { value: toRichText('Updated geo label'), invalid: { type: 'doc', content: 'bad' } },
    },
    text: {
        color: { value: 'blue', invalid: 'unsupported-color' },
        size: { value: 'xl', invalid: 'unsupported-size' },
        font: { value: 'mono', invalid: 'unsupported-font' },
        textAlign: { value: 'end', invalid: 'unsupported-align' },
        w: {
            value: 320,
            invalid: 0,
            setup: { autoSize: false },
            note: '固定宽度需关闭自动宽度。'
        },
        richText: { value: toRichText('Updated text\nSecond paragraph'), invalid: { type: 'doc', content: false } },
        scale: { value: 1.25, invalid: 0 },
        autoSize: { value: false, invalid: 'false' },
    },
    note: {
        color: { value: 'yellow', invalid: 'unsupported-color' },
        labelColor: { value: 'blue', invalid: 'unsupported-color' },
        size: { value: 's', invalid: 'unsupported-size' },
        font: { value: 'serif', invalid: 'unsupported-font' },
        fontSizeAdjustment: {
            value: 18,
            invalid: -1,
            readonly: true,
            note: '原生便签文字排版计算的字号调整。'
        },
        align: { value: 'end', invalid: 'unsupported-align' },
        verticalAlign: { value: 'start', invalid: 'unsupported-align' },
        growY: {
            value: 70,
            invalid: -1,
            readonly: true,
            note: '便签文字排版派生的额外高度。'
        },
        url: { value: 'https://example.com/note', invalid: 'javascript:alert(1)' },
        richText: { value: toRichText('Updated note'), invalid: { type: 'doc', content: 1 } },
        scale: { value: 1.25, invalid: 0 },
    },
    line: {
        color: { value: 'green', invalid: 'unsupported-color' },
        dash: { value: 'dotted', invalid: 'unsupported-dash' },
        size: { value: 's', invalid: 'unsupported-size' },
        spline: { value: 'cubic', invalid: 'unsupported-spline' },
        points: {
            value: {
                a1: {
                    id: 'a1',
                    index: 'a1',
                    x: 0,
                    y: 0
                },
                a2: {
                    id: 'a2',
                    index: 'a2',
                    x: 70,
                    y: 80
                },
                a3: {
                    id: 'a3',
                    index: 'a3',
                    x: 200,
                    y: 20
                },
            },
            invalid: {
                a1: {
                    id: 'a1',
                    index: 'a1',
                    x: 'bad',
                    y: 0
                }
            }
        },
        scale: { value: 1.25, invalid: 0 },
    },
    arrow: {
        kind: { value: 'elbow', invalid: 'unsupported-kind' },
        labelColor: { value: 'violet', invalid: 'unsupported-color' },
        color: { value: 'blue', invalid: 'unsupported-color' },
        fill: { value: 'solid', invalid: 'unsupported-fill' },
        dash: { value: 'solid', invalid: 'unsupported-dash' },
        size: { value: 'l', invalid: 'unsupported-size' },
        arrowheadStart: { value: 'dot', invalid: 'unsupported-arrowhead' },
        arrowheadEnd: { value: 'triangle', invalid: 'unsupported-arrowhead' },
        font: { value: 'sans', invalid: 'unsupported-font' },
        start: { value: { x: 15, y: 25 }, invalid: { x: 'bad', y: 0 } },
        end: { value: { x: 240, y: 80 }, invalid: { x: 10 } },
        bend: {
            value: 50,
            invalid: 'bad',
            setup: { kind: 'arc' }
        },
        richText: { value: toRichText('Updated arrow label'), invalid: { type: 'doc', content: null } },
        labelPosition: {
            value: 0.7,
            invalid: 'bad',
            setup: { richText: toRichText('Label') }
        },
        scale: { value: 1.25, invalid: 0 },
        elbowMidPoint: {
            value: 0.7,
            invalid: 'bad',
            setup: { kind: 'elbow' }
        },
    },
    draw: {
        color: { value: 'orange', invalid: 'unsupported-color' },
        fill: { value: 'pattern', invalid: 'unsupported-fill' },
        dash: { value: 'dashed', invalid: 'unsupported-dash' },
        size: { value: 'xl', invalid: 'unsupported-size' },
        segments: {
            value: NEXT_SEGMENTS,
            invalid: [{ type: 'free', path: 42 }],
            note: '覆盖 free / straight，path 使用原生 b64Vecs 编码。'
        },
        isComplete: { value: true, invalid: 1 },
        isClosed: { value: true, invalid: 'true' },
        isPen: { value: true, invalid: null },
        scale: { value: 1.25, invalid: 0 },
        scaleX: { value: 1.5, invalid: 0 },
        scaleY: { value: 0.75, invalid: 0 },
    },
    highlight: {
        color: { value: 'yellow', invalid: 'unsupported-color' },
        size: { value: 'l', invalid: 'unsupported-size' },
        segments: { value: NEXT_SEGMENTS, invalid: [{ type: 'unsupported-segment', path: '' }] },
        isComplete: { value: true, invalid: 'true' },
        isPen: { value: true, invalid: 1 },
        scale: { value: 1.25, invalid: 0 },
        scaleX: { value: 1.5, invalid: 0 },
        scaleY: { value: 0.75, invalid: 0 },
    },
    frame: {
        w: { value: 440, invalid: 0 },
        h: { value: 300, invalid: 0 },
        name: { value: 'Updated frame', invalid: 42 },
        color: { value: 'green', invalid: 'unsupported-color' },
    },
    group: {},
    bookmark: {
        w: { value: 340, invalid: 0 },
        h: {
            value: 190,
            invalid: 0,
            readonly: true,
            note: '创建及资产切换时由本地书签标题/图片推导高度。'
        },
        assetId: { value: BOOKMARK_NEXT_ID, invalid: 'not-an-asset-id' },
        url: {
            value: BOOKMARK_NEXT_URL,
            invalid: 'javascript:alert(1)',
            note: 'TEST_ASSETS 含 URL 哈希对应资产，更新无需联网。'
        },
    },
    embed: {
        w: { value: 420, invalid: 0 },
        h: { value: 280, invalid: 0 },
        url: {
            value: 'https://example.com/embed-fixture',
            invalid: 42,
            note: '只测试数据；非支持站点不会创建远程 iframe。'
        },
    },
    image: {
        w: { value: 240, invalid: 0 },
        h: { value: 180, invalid: 0 },
        playing: { value: false, invalid: 'false' },
        url: { value: 'https://example.com/image-link', invalid: 'javascript:alert(1)' },
        assetId: { value: IMAGE_NEXT_ID, invalid: 'not-an-asset-id' },
        crop: {
            value: {
                topLeft: { x: 0.1, y: 0.2 },
                bottomRight: { x: 0.9, y: 0.8 },
                isCircle: true
            },
            invalid: { topLeft: { x: 'bad', y: 0 }, bottomRight: { x: 1, y: 1 } }
        },
        flipX: { value: true, invalid: 1 },
        flipY: { value: true, invalid: 'true' },
        altText: { value: 'Updated local image description', invalid: 42 },
    },
    video: {
        w: { value: 320, invalid: 0 },
        h: { value: 180, invalid: 0 },
        time: {
            value: 12,
            invalid: 'bad',
            note: '原生遗留同步字段，验证记录写入，不验证播放。'
        },
        playing: { value: false, invalid: 'false' },
        autoplay: { value: false, invalid: 1 },
        url: { value: 'https://example.com/video-link', invalid: 'javascript:alert(1)' },
        assetId: { value: VIDEO_NEXT_ID, invalid: 'not-an-asset-id' },
        altText: { value: 'Updated local video description', invalid: false },
    },
}

/** tldraw 4.5.3 原生箭头绑定恰有五个 props；terminal 对应公开接口的 start/end 键。 */
export const BINDING_PROPERTY_CASES: Record<string, ShapePropertyCase> = {
    terminal: { value: 'end', invalid: 'middle' },
    normalizedAnchor: { value: { x: 0.2, y: 0.8 }, invalid: { x: 'bad', y: 0.5 } },
    isExact: { value: true, invalid: 1 },
    isPrecise: { value: false, invalid: 'false' },
    snap: { value: 'edge', invalid: 'unsupported-snap' },
}

/** 枚举单独穷举；测试器应沿用相应属性 case 的 setup。 */
export const ENUM_PROPERTY_VALUES: Record<string, Record<string, readonly unknown[]>> = {
    geo: {
        geo: GeoShapeGeoStyle.values,
        color: DefaultColorStyle.values,
        labelColor: DefaultLabelColorStyle.values,
        fill: DefaultFillStyle.values,
        dash: DefaultDashStyle.values,
        size: DefaultSizeStyle.values,
        font: DefaultFontStyle.values,
        align: DefaultHorizontalAlignStyle.values,
        verticalAlign: DefaultVerticalAlignStyle.values
    },
    text: {
        color: DefaultColorStyle.values,
        size: DefaultSizeStyle.values,
        font: DefaultFontStyle.values,
        textAlign: DefaultTextAlignStyle.values
    },
    note: {
        color: DefaultColorStyle.values,
        labelColor: DefaultLabelColorStyle.values,
        size: DefaultSizeStyle.values,
        font: DefaultFontStyle.values,
        align: DefaultHorizontalAlignStyle.values,
        verticalAlign: DefaultVerticalAlignStyle.values
    },
    line: {
        color: DefaultColorStyle.values,
        dash: DefaultDashStyle.values,
        size: DefaultSizeStyle.values,
        spline: LineShapeSplineStyle.values
    },
    arrow: {
        kind: ArrowShapeKindStyle.values,
        color: DefaultColorStyle.values,
        labelColor: DefaultLabelColorStyle.values,
        fill: DefaultFillStyle.values,
        dash: DefaultDashStyle.values,
        size: DefaultSizeStyle.values,
        font: DefaultFontStyle.values,
        arrowheadStart: ArrowShapeArrowheadStartStyle.values,
        arrowheadEnd: ArrowShapeArrowheadEndStyle.values
    },
    draw: {
        color: DefaultColorStyle.values,
        fill: DefaultFillStyle.values,
        dash: DefaultDashStyle.values,
        size: DefaultSizeStyle.values
    },
    highlight: { color: DefaultColorStyle.values, size: DefaultSizeStyle.values },
    frame: { color: DefaultColorStyle.values },
    group: {},
    bookmark: {},
    embed: {},
    image: {},
    video: {},
}

export const BINDING_ENUM_PROPERTY_VALUES: Record<string, readonly unknown[]> = {
    terminal: ['start', 'end'], snap: ['center', 'edge-point', 'edge', 'none'],
}
