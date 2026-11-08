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

        ctx.server.get('/foxy-memory/health', async (koa) => {
            koa.body = {
                ok: true,
                service: 'chatluna-foxy-memory',
                preset: defaultPreset(config)
            }
        })

        ctx.server.post('/foxy-memory/record', async (koa) => {
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

        ctx.server.post('/foxy-memory/ingest', async (koa) => {
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

        ctx.server.post('/foxy-memory/context', async (koa) => {
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
