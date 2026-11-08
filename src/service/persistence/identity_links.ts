import { randomUUID } from 'node:crypto'
import type { Context } from 'koishi'
import type {
    IdentityLinkInput,
    IdentityLinkRecord
} from '../../contracts/memory'
import type { LivingMemoryTransact } from './types'

const normalize = (value: string) => value.trim()

export class FoxyIdentityLinkRepository {
    constructor(
        private readonly ctx: Context,
        private readonly transact: LivingMemoryTransact
    ) {}

    async listIdentityLinks(presetId: string): Promise<IdentityLinkRecord[]> {
        const rows = await this.ctx.database.get('foxy_identity_link', {
            presetId
        })
        return rows
            .map((row) => ({
                ...row,
                confidence: Number(row.confidence),
                createdAt: new Date(row.createdAt),
                updatedAt: new Date(row.updatedAt)
            }))
            .sort(
                (left, right) =>
                    left.platform.localeCompare(right.platform) ||
                    left.platformUserId.localeCompare(right.platformUserId)
            )
    }

    async upsertIdentityLink(input: IdentityLinkInput) {
        const presetId = normalize(input.presetId)
        const platform = normalize(input.platform)
        const platformUserId = normalize(input.platformUserId)
        const canonicalSpeakerKey = normalize(input.canonicalSpeakerKey)
        if (!presetId || !platform || !platformUserId || !canonicalSpeakerKey) {
            return
        }

        const now = new Date()
        await this.transact(async (database) => {
            const existing = (
                await database.get('foxy_identity_link', {
                    presetId,
                    platform,
                    platformUserId
                })
            )[0]
            const record = {
                presetId,
                platform,
                platformUserId,
                canonicalSpeakerKey,
                confidence: input.confidence ?? 1,
                source: normalize(input.source ?? 'manual') || 'manual',
                updatedAt: now
            }
            if (existing) {
                await database.set(
                    'foxy_identity_link',
                    { id: existing.id },
                    record
                )
                return
            }
            await database.create('foxy_identity_link', {
                ...record,
                id: randomUUID(),
                createdAt: now
            })
        })
    }

    async deleteIdentityLink(id: string) {
        await this.transact(async (database) => {
            await database.remove('foxy_identity_link', { id })
        })
    }
}
