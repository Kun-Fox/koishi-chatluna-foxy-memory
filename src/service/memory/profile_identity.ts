import type { UserProfileRecord } from '../../contracts/memory'
import {
    buildIdentityAliasMap,
    resolveIdentityLabel
} from './identity_aliases'

const newestFirst = (left: UserProfileRecord, right: UserProfileRecord) =>
    +right.updatedAt - +left.updatedAt || left.id.localeCompare(right.id)

/**
 * 按身份别名把同一人的画像合并成一行。数据库仍保留原始 speakerKey，
 * 合并只发生在读取层，避免改写既有画像记录。
 */
export const mergeUserProfilesByIdentity = (
    profiles: UserProfileRecord[],
    aliasGroups: string[] = []
): UserProfileRecord[] => {
    const aliases = buildIdentityAliasMap(aliasGroups)
    if (aliases.size === 0) return profiles

    const groups = new Map<string, UserProfileRecord[]>()
    for (const profile of profiles) {
        const canonical = resolveIdentityLabel(
            profile.speakerKey,
            profile.speakerLabel,
            aliases
        )
        const group = groups.get(canonical) ?? []
        group.push(profile)
        groups.set(canonical, group)
    }

    return [...groups.entries()].map(([canonical, group]) => {
        const [base] = [...group].sort(newestFirst)
        const sourceMemoryIds = [
            ...new Set(group.flatMap((profile) => profile.sourceMemoryIds))
        ]
        const platforms = [
            ...new Set(
                group.flatMap((profile) => profile.platforms ?? [])
            )
        ]
        return {
            ...base,
            speakerLabel:
                group.find((profile) => profile.speakerKey === canonical)
                    ?.speakerLabel ?? canonical,
            sourceMemoryIds: sourceMemoryIds.sort(),
            platforms: platforms.sort()
        }
    })
}
