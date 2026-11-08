import { Context } from 'koishi'
import type { MemoryEntryType, MemoryScope } from '../contracts/memory'
import type { LivingMemoryConfig } from '../contracts/workflows'
import type { ChatLunaLivingMemoryService } from '../service/app/living_memory_service'

interface RecordPayload {
    presetId?: string
    sessionId?: string
    conversationId?: string
    platform?: string
    channelType?: string
    channelId?: string
    sourceLabel?: string
    eventType?: string
    text?: string
    content?: string
    role?: 'user' | 'assistant' | 'system'
    speakerKey?: string
    speakerLabel?: string
    type?: MemoryEntryType
    keywords?: string[]
    summary?: string | null
    importance?: number | null
}

interface IngestPayload extends RecordPayload {
    messages?: Array<{
        role?: 'user' | 'assistant' | 'system'
        text?: string
        content?: string
        speakerKey?: string
        speakerLabel?: string
        createdAt?: string | number
    }>
}

const defaultPreset = (config: LivingMemoryConfig) =>
    config.foxyApiDefaultPresetId?.trim() || 'foxy3（Character）'

const textOf = (payload: RecordPayload) =>
    (payload.text ?? payload.content ?? '').trim()

const typeOf = (payload: RecordPayload): MemoryEntryType =>
    payload.type ?? 'fact'

const scopeOf = (
    config: LivingMemoryConfig,
    payload: RecordPayload
): MemoryScope => {
    const presetId = payload.presetId?.trim() || defaultPreset(config)
    const platform = payload.platform?.trim() || 'dsh'
    const channelType = payload.channelType?.trim() || 'private'
    const conversationId =
        payload.conversationId?.trim() ||
        [
            platform,
            channelType,
            payload.channelId?.trim() ||
                payload.sessionId?.trim() ||
                'default'
        ].join(':')
    return {
        presetId,
        conversationId,
        platform,
        isDirect: channelType !== 'group',
        speakerId: payload.speakerKey?.trim(),
        userId: payload.speakerKey?.trim()
    }
}

const isLoopback = (address: string | undefined) =>
    !address ||
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'

const authorized = (
    config: LivingMemoryConfig,
    token: string,
    remoteAddress: string | undefined
) => {
    const expected = config.foxyApiToken?.trim()
    if (!expected) return isLoopback(remoteAddress)
    return token === expected
}

const prefix = (payload: RecordPayload, text: string) => {
    const role = payload.role === 'assistant' ? 'Foxy' : '用户'
    const label = payload.speakerLabel?.trim() || payload.sourceLabel?.trim()
    return label ? `${label}（${role}）：${text}` : `${role}：${text}`
}

export function apply(ctx: Context, config: LivingMemoryConfig) {
    ctx.inject(['server'], (ctx) => {
        const service = (): ChatLunaLivingMemoryService =>
            ctx.chatluna_living_memory

        ctx.server.get('/foxy-memory/health', async (koa: any) => {
            koa.body = {
                ok: true,
                service: 'chatluna-foxy-memory',
                preset: defaultPreset(config)
            }
        })

        ctx.server.post('/foxy-memory/record', async (koa: any) => {
            const token = String(koa.headers.authorization ?? '').replace(
                /^Bearer\s+/iu,
                ''
            )
            if (!authorized(config, token, koa.req?.socket?.remoteAddress)) {
                koa.status = 401
                koa.body = { ok: false, error: 'unauthorized' }
                return
            }
            const payload = (koa.request.body ?? {}) as RecordPayload
            const text = textOf(payload)
            if (!text) {
                koa.status = 400
                koa.body = { ok: false, error: 'text is required' }
                return
            }
            const memory = await service().createMemory(
                scopeOf(config, payload),
                {
                    type: typeOf(payload),
                    content: prefix(payload, text),
                    keywords: payload.keywords ?? [],
                    summary: payload.summary ?? null,
                    importance: payload.importance ?? null
                },
                payload.speakerKey ? [payload.speakerKey] : undefined
            )
            koa.body = { ok: true, created: 1, ids: [memory.id] }
        })

        ctx.server.post('/foxy-memory/ingest', async (koa: any) => {
            const token = String(koa.headers.authorization ?? '').replace(
                /^Bearer\s+/iu,
                ''
            )
            if (!authorized(config, token, koa.req?.socket?.remoteAddress)) {
                koa.status = 401
                koa.body = { ok: false, error: 'unauthorized' }
                return
            }
            const payload = (koa.request.body ?? {}) as IngestPayload
            const messages = Array.isArray(payload.messages)
                ? payload.messages
                : []
            const ids: string[] = []
            for (const message of messages) {
                const text = (message.text ?? message.content ?? '').trim()
                if (!text) continue
                const record = {
                    ...payload,
                    role: message.role ?? payload.role,
                    speakerKey: message.speakerKey ?? payload.speakerKey,
                    speakerLabel: message.speakerLabel ?? payload.speakerLabel
                }
                const memory = await service().createMemory(
                    scopeOf(config, record),
                    {
                        type: typeOf(record),
                        content: prefix(record, text),
                        keywords: payload.keywords ?? [],
                        summary: payload.summary ?? null,
                        importance: payload.importance ?? null
                    },
                    record.speakerKey ? [record.speakerKey] : undefined
                )
                ids.push(memory.id)
            }
            koa.body = { ok: true, created: ids.length, ids }
        })

        ctx.server.post('/foxy-memory/send-private', async (koa: any) => {
            const token = String(koa.headers.authorization ?? '').replace(
                /^Bearer\s+/iu,
                ''
            )
            if (!authorized(config, token, koa.req?.socket?.remoteAddress)) {
                koa.status = 401
                koa.body = { ok: false, error: 'unauthorized' }
                return
            }
            const payload = (koa.request.body ?? {}) as {
                userId?: string
                selfId?: string
                text?: string
            }
            const text = payload.text?.trim()
            const target =
                payload.userId?.trim() ||
                config.foxyOwnerId?.trim() ||
                ''
            if (!text || !target) {
                koa.status = 400
                koa.body = { ok: false, error: 'text and userId are required' }
                return
            }
            const bots = [...ctx.bots]
            const bot =
                bots.find((item) => item.selfId === payload.selfId) ??
                bots.find(
                    (item) => item.selfId === config.foxyBotId?.trim()
                ) ??
                bots[0]
            if (!bot) {
                koa.status = 503
                koa.body = { ok: false, error: 'no bot available' }
                return
            }
            try {
                const messageIds = await bot.sendPrivateMessage(target, text)
                koa.body = {
                    ok: true,
                    userId: target,
                    botId: bot.selfId,
                    messageIds
                }
            } catch (error) {
                koa.status = 502
                koa.body = {
                    ok: false,
                    error: error instanceof Error ? error.message : String(error)
                }
            }
        })

        ctx.server.get('/foxy-memory/export', async (koa: any) => {
            const token = String(koa.headers.authorization ?? '').replace(
                /^Bearer\s+/iu,
                ''
            )
            if (!authorized(config, token, koa.req?.socket?.remoteAddress)) {
                koa.status = 401
                koa.body = { ok: false, error: 'unauthorized' }
                return
            }
            const presetId =
                String(koa.query?.presetId ?? '').trim() || defaultPreset(config)
            const data = await service().exportPreset(presetId)
            koa.body = { ok: true, presetId, data }
        })

        ctx.server.post('/foxy-memory/import', async (koa: any) => {
            const token = String(koa.headers.authorization ?? '').replace(
                /^Bearer\s+/iu,
                ''
            )
            if (!authorized(config, token, koa.req?.socket?.remoteAddress)) {
                koa.status = 401
                koa.body = { ok: false, error: 'unauthorized' }
                return
            }
            const payload = (koa.request.body ?? {}) as {
                targetPresetId?: string
                data?: unknown
            }
            const targetPresetId =
                payload.targetPresetId?.trim() || defaultPreset(config)
            const data = payload.data as Parameters<
                ChatLunaLivingMemoryService['importPreset']
            >[1]
            if (!data || typeof data !== 'object') {
                koa.status = 400
                koa.body = { ok: false, error: 'data is required' }
                return
            }
            const result = await service().importPreset(targetPresetId, data)
            koa.body = { ok: true, targetPresetId, ...result }
        })

        ctx.server.post('/foxy-memory/list', async (koa: any) => {
            const token = String(koa.headers.authorization ?? '').replace(
                /^Bearer\s+/iu,
                ''
            )
            if (!authorized(config, token, koa.req?.socket?.remoteAddress)) {
                koa.status = 401
                koa.body = { ok: false, error: 'unauthorized' }
                return
            }
            const payload = (koa.request.body ?? {}) as {
                presetId?: string
                platform?: string
                status?: 'active' | 'archived' | 'all'
                keyword?: string
                page?: number
                pageSize?: number
            }
            const presetId = payload.presetId?.trim() || defaultPreset(config)
            const result = await service().listMemories({
                presetId,
                platform: payload.platform?.trim() || undefined,
                status: payload.status ?? 'active',
                keyword: payload.keyword?.trim() || undefined,
                page: Math.max(1, Number(payload.page) || 1),
                pageSize: Math.min(100, Math.max(1, Number(payload.pageSize) || 20))
            })
            koa.body = { ok: true, ...result }
        })

        ctx.server.post('/foxy-memory/search', async (koa: any) => {
            const token = String(koa.headers.authorization ?? '').replace(
                /^Bearer\s+/iu,
                ''
            )
            if (!authorized(config, token, koa.req?.socket?.remoteAddress)) {
                koa.status = 401
                koa.body = { ok: false, error: 'unauthorized' }
                return
            }
            const payload = (koa.request.body ?? {}) as {
                presetId?: string
                query?: string
                platform?: string
                limit?: number
            }
            const query = payload.query?.trim()
            if (!query) {
                koa.status = 400
                koa.body = { ok: false, error: 'query is required' }
                return
            }
            const presetId = payload.presetId?.trim() || defaultPreset(config)
            const results = await service().searchMemories(presetId, {
                searchTexts: [query],
                memoryTypes: ['all']
            })
            const memories = results.slice(
                0,
                Math.min(100, Math.max(1, Number(payload.limit) || 20))
            )
            koa.body = {
                ok: true,
                presetId,
                memories,
                text: memories.map((item) => item.content).join('\n')
            }
        })

        ctx.server.post('/foxy-memory/context', async (koa: any) => {
            const token = String(koa.headers.authorization ?? '').replace(
                /^Bearer\s+/iu,
                ''
            )
            if (!authorized(config, token, koa.req?.socket?.remoteAddress)) {
                koa.status = 401
                koa.body = { ok: false, error: 'unauthorized' }
                return
            }
            const payload = (koa.request.body ?? {}) as {
                presetId?: string
                sessionId?: string
                conversationId?: string
                query?: string
                limit?: number
            }
            const query = payload.query?.trim()
            if (!query) {
                koa.status = 400
                koa.body = { ok: false, error: 'query is required' }
                return
            }
            const presetId = payload.presetId?.trim() || defaultPreset(config)
            const conversationId =
                payload.conversationId?.trim() ||
                (payload.sessionId
                    ? `dsh:private:${payload.sessionId}`
                    : undefined)
            const results = await service().searchMemories(
                presetId,
                {
                    searchTexts: [query],
                    memoryTypes: ['all']
                },
                conversationId
            )
            const memories = results.slice(0, payload.limit ?? 10)
            koa.body = {
                ok: true,
                presetId,
                text: memories.map((item) => item.content).join('\n'),
                memories
            }
        })
    })
}
