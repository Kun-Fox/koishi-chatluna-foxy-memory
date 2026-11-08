// ChatLuna 1.4.x 的 utils/error 会反向 require 主入口；任何插件在 ChatLuna
// 主入口初始化完成前静态导入该子路径，都会触发循环依赖并把 ChatLunaErrorCode
// 变成 undefined，最终让整个 Koishi 启动失败。这里保留同样的判定语义，但不
// 依赖 ChatLuna 的子路径模块。
const REQUEST_FAILURE_CODES = new Set([1, 102, 103, 105, 5])

export function isRequestFailure(error: unknown): boolean {
    if (error instanceof Error) {
        if (error.name === 'AbortError') return true
        const code = (error as Error & { code?: unknown }).code
        if (code === 'ABORT_ERR') return true
    }
    const errorCode = (
        error as { errorCode?: unknown; code?: unknown } | null | undefined
    )?.errorCode
    return typeof errorCode === 'number' && REQUEST_FAILURE_CODES.has(errorCode)
}

export function isOutputParserException(error: unknown): boolean {
    return (
        error instanceof Error &&
        (error.name === 'OutputParserException' ||
            error.constructor?.name === 'OutputParserException')
    )
}
