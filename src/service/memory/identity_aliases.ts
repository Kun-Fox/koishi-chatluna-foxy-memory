/**
 * 跨平台身份别名。每个数组项是一组用逗号分隔的昵称或 speakerKey，
 * 首项作为统一展示名。配置为空时保持 LivingMemory 原有行为。
 */
export type IdentityAliasMap = Map<string, string>

export const buildIdentityAliasMap = (groups: string[] = []): IdentityAliasMap => {
    const aliases: IdentityAliasMap = new Map()
    for (const group of groups) {
        const members = group
            .split(',')
            .map((member) => member.trim())
            .filter(Boolean)
        if (members.length < 2) continue
        const canonical = members[0]
        for (const member of members) {
            aliases.set(member, canonical)
        }
    }
    return aliases
}

export const resolveIdentityLabel = (
    speakerKey: string,
    speakerLabel: string,
    aliases: IdentityAliasMap
) => {
    return (
        aliases.get(speakerKey) ??
        aliases.get(speakerLabel) ??
        aliases.get(speakerKey.trim()) ??
        aliases.get(speakerLabel.trim()) ??
        speakerLabel
    )
}
