import { randomUUID } from 'crypto'
import { Context } from 'koishi'
import type {
    MemoryEntryRecord,
    PresetSpeakerInput,
    PresetSpeakerRecord,
    ProfileKeywordRecord,
    UserProfileInput,
    UserProfileRecord
} from '../../contracts/memory'
import {
    createPresetSpeakerId,
    normalizeEntryRecord,
    normalizeOptionalString,
    normalizePresetSpeakerRecord,
    normalizeUserProfileRecord
} from './normalizers'
import type { UserProfileRepository } from '../../contracts/workflows'
import type { LivingMemoryTransact } from './types'

/** 规范行排在最前：createdAt 最早者胜，同刻按 id 定序保证结果稳定。 */
const compareProfilesByCanonicalOrder = (
    left: UserProfileRecord,
    right: UserProfileRecord
) => +left.createdAt - +right.createdAt || left.id.localeCompare(right.id)

const uniquePlatforms = (values: Array<string | null | undefined>) => [
    ...new Set(values.filter((value): value is string => Boolean(value)))
]

const normalizeKeywords = (values: string[] | undefined) => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const value of values ?? []) {
        const keyword = String(value ?? '').trim()
        const key = keyword.toLocaleLowerCase()
        if (keyword.length < 2 || seen.has(key)) continue
        seen.add(key)
        result.push(keyword)
        if (result.length >= 20) break
    }
    return result
}

export class LivingMemoryUserProfileRepository implements UserProfileRepository {
    constructor(
        private readonly ctx: Context,
        private readonly transact: LivingMemoryTransact
    ) {}

    async listPresetSpeakers(presetId: string): Promise<PresetSpeakerRecord[]> {
        const speakers = await this.ctx.database.get(
            'living_memory_preset_speaker',
            { presetId }
        )

        return speakers
            .map(normalizePresetSpeakerRecord)
            .filter(
                (speaker) =>
                    speaker.speakerKey.length > 0 &&
                    speaker.speakerLabel.length > 0
            )
            .sort((left, right) =>
                left.speakerLabel.localeCompare(right.speakerLabel)
            )
    }

    async upsertPresetSpeaker(input: PresetSpeakerInput) {
        const presetId = input.presetId.trim()
        const speakerKey = input.speakerKey.trim()
        const speakerLabel = input.speakerLabel.trim()
        if (
            presetId.length === 0 ||
            speakerKey.length === 0 ||
            speakerLabel.length === 0
        ) {
            return
        }

        const now = new Date()
        const id = createPresetSpeakerId(presetId, speakerKey)
        const record = {
            presetId,
            speakerKey,
            speakerLabel,
            speakerAliases: [speakerLabel],
            speakerId: normalizeOptionalString(input.speakerId),
            platform: normalizeOptionalString(input.platform),
            updatedAt: now
        }
        await this.transact(async (database) => {
            const existing = (
                await database.get('living_memory_preset_speaker', { id })
            )[0]

            if (existing == null) {
                await database.create('living_memory_preset_speaker', {
                    ...record,
                    id,
                    createdAt: now
                })
                return
            }

            await database.set('living_memory_preset_speaker', { id }, record)
        })
    }

    /**
     * 铸键不变量的基座：为缺失的键补注册行，缺失才写，不触碰既有行的标签
     * 与身份字段（标签更新归 reconcile）。行不带身份字段，画像候选过滤
     * 天然排除；该用户下次直接对话时 reconcile 按 stableId 命中同一行，
     * 覆盖升级为完整身份。
     */
    async registerMissingPresetSpeakers(
        presetId: string,
        speakers: Array<{ speakerKey: string; speakerLabel: string }>
    ) {
        const candidates = new Map<string, string>()
        for (const speaker of speakers) {
            const speakerKey = speaker.speakerKey.trim()
            const speakerLabel = speaker.speakerLabel.trim()
            if (
                presetId.length > 0 &&
                speakerKey.length > 0 &&
                speakerLabel.length > 0 &&
                !candidates.has(speakerKey)
            ) {
                candidates.set(speakerKey, speakerLabel)
            }
        }
        if (candidates.size === 0) {
            return
        }

        await this.transact(async (database) => {
            const existing = await database.get(
                'living_memory_preset_speaker',
                {
                    presetId,
                    speakerKey: { $in: [...candidates.keys()] }
                }
            )
            const existingKeys = new Set(existing.map((row) => row.speakerKey))
            const missing = [...candidates]
                .filter(([speakerKey]) => !existingKeys.has(speakerKey))
                .map(([speakerKey, speakerLabel]) => ({
                    id: createPresetSpeakerId(presetId, speakerKey),
                    presetId,
                    speakerKey,
                    speakerLabel,
                    speakerAliases: [speakerLabel],
                    speakerId: null,
                    platform: null,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }))
            if (missing.length > 0) {
                await database.upsert('living_memory_preset_speaker', missing)
            }
        })
    }

    private async attachPlatforms(
        profiles: UserProfileRecord[]
    ): Promise<UserProfileRecord[]> {
        const ids = [
            ...new Set(profiles.flatMap((profile) => profile.sourceMemoryIds))
        ]
        if (ids.length === 0) return profiles

        const rows = await this.ctx.database.get('living_memory_entry', {
            id: { $in: ids }
        })
        const platformById = new Map(
            rows.map((row) => [
                row.id,
                normalizeEntryRecord(row as MemoryEntryRecord).platform
            ])
        )

        return profiles.map((profile) => ({
            ...profile,
            platforms: uniquePlatforms(
                profile.sourceMemoryIds.map((id) => platformById.get(id))
            )
        }))
    }

    private async attachKeywords(
        profiles: UserProfileRecord[]
    ): Promise<UserProfileRecord[]> {
        if (profiles.length === 0) return profiles
        const presetId = profiles[0].presetId
        const rows = await this.ctx.database.get('foxy_profile_keyword', {
            presetId
        })
        const keywordMap = new Map<string, string[]>()
        for (const row of rows as ProfileKeywordRecord[]) {
            const current = keywordMap.get(row.speakerKey) ?? []
            current.push(row.keyword)
            keywordMap.set(row.speakerKey, current)
        }
        return profiles.map((profile) => ({
            ...profile,
            keywords: normalizeKeywords(keywordMap.get(profile.speakerKey))
        }))
    }

    async listUserProfilesByPreset(
        presetId: string
    ): Promise<UserProfileRecord[]> {
        const profiles = await this.ctx.database.get(
            'living_memory_user_profile',
            { presetId }
        )

        return (
            await this.attachKeywords(
                await this.attachPlatforms(
                    profiles.map(normalizeUserProfileRecord)
                )
            )
        ).sort((left, right) =>
            left.speakerLabel.localeCompare(right.speakerLabel)
        )
    }

    async listUserProfilesBySpeakerKeys(
        presetId: string,
        speakerKeys: string[]
    ): Promise<UserProfileRecord[]> {
        const keys = [...new Set(speakerKeys)].filter((key) => key.length > 0)
        if (keys.length === 0) {
            return []
        }

        const profiles = await this.ctx.database.get(
            'living_memory_user_profile',
            {
                presetId,
                speakerKey: {
                    $in: keys
                }
            }
        )

        // 同一 speakerKey 可能残留重复行，规范行的口径必须与
        // replaceUserProfile 的写入目标一致，否则读到的画像不是最后写入的那行。
        return (
            await this.attachKeywords(
                await this.attachPlatforms(
                    profiles.map(normalizeUserProfileRecord)
                )
            )
        ).sort(compareProfilesByCanonicalOrder)
    }

    async replaceUserProfile(presetId: string, profile: UserProfileInput) {
        await this.transact(async (database) => {
            const existing = (
                await database.get('living_memory_user_profile', {
                    presetId,
                    speakerKey: profile.speakerKey
                })
            )
                .map(normalizeUserProfileRecord)
                .sort(compareProfilesByCanonicalOrder)
            const current = existing[0]
            const now = new Date()
            const record = {
                presetId,
                speakerKey: profile.speakerKey,
                speakerLabel: profile.speakerLabel,
                content: profile.content,
                sourceMemoryIds: profile.sourceMemoryIds,
                updatedAt: now
            }

            if (current == null) {
                await database.create('living_memory_user_profile', {
                    ...record,
                    id: randomUUID(),
                    createdAt: now
                })
                return
            }

            await database.set(
                'living_memory_user_profile',
                { id: current.id },
                record
            )

            const staleIds = existing.slice(1).map((stale) => stale.id)
            if (staleIds.length > 0) {
                await database.remove('living_memory_user_profile', {
                    id: {
                        $in: staleIds
                    }
                })
            }
        })
    }

    async updateUserProfileContent(profileId: string, content: string) {
        await this.ctx.database.set(
            'living_memory_user_profile',
            { id: profileId },
            { content, updatedAt: new Date() }
        )
    }

    /** 记下画像已按这组记忆审阅且无需改写：只刷新输入与时刻，正文不动。 */
    async markUserProfileReviewed(
        profileId: string,
        sourceMemoryIds: string[]
    ) {
        await this.ctx.database.set(
            'living_memory_user_profile',
            { id: profileId },
            { sourceMemoryIds, updatedAt: new Date() }
        )
    }

    async deleteUserProfile(profileId: string) {
        await this.ctx.database.remove('living_memory_user_profile', {
            id: profileId
        })
    }

    async listProfileKeywords(presetId: string): Promise<ProfileKeywordRecord[]> {
        return (await this.ctx.database.get('foxy_profile_keyword', {
            presetId
        })) as ProfileKeywordRecord[]
    }

    async replaceProfileKeywords(
        presetId: string,
        speakerKey: string,
        keywords: string[]
    ) {
        const normalizedPreset = presetId.trim()
        const normalizedSpeaker = speakerKey.trim()
        if (!normalizedPreset || !normalizedSpeaker) return
        const normalized = normalizeKeywords(keywords)
        await this.transact(async (database) => {
            await database.remove('foxy_profile_keyword', {
                presetId: normalizedPreset,
                speakerKey: normalizedSpeaker
            })
            if (normalized.length === 0) return
            const now = new Date()
            for (const keyword of normalized) {
                await database.create('foxy_profile_keyword', {
                    id: randomUUID(),
                    presetId: normalizedPreset,
                    speakerKey: normalizedSpeaker,
                    keyword,
                    createdAt: now,
                    updatedAt: now
                })
            }
        })
    }
}
