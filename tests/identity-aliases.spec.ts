import { describe, expect, it } from 'vitest'
import {
    buildIdentityAliasMap,
    resolveIdentityLabel
} from '../src/service/memory/identity_aliases'

describe('identity aliases', () => {
    it('merges keys and labels into one canonical identity', () => {
        const aliases = buildIdentityAliasMap(['kunfox, nogitsune, 小狐狸'])

        expect(resolveIdentityLabel('kunfox', 'kunfox', aliases)).toBe('kunfox')
        expect(resolveIdentityLabel('qq:123', 'nogitsune', aliases)).toBe(
            'kunfox'
        )
        expect(resolveIdentityLabel('weibo:456', '小狐狸', aliases)).toBe(
            'kunfox'
        )
    })

    it('ignores groups with fewer than two members', () => {
        const aliases = buildIdentityAliasMap(['kunfox', 'a,b'])

        expect(aliases.get('a')).toBe('a')
        expect(aliases.has('kunfox')).toBe(false)
    })
})
