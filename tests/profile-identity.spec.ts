import assert from 'node:assert/strict'
import { mergeUserProfilesByIdentity } from '../src/service/memory/profile_identity'
import type { UserProfileRecord } from '../src/contracts/memory'

const profile = (
    input: Partial<UserProfileRecord> & Pick<UserProfileRecord, 'id' | 'speakerKey'>
): UserProfileRecord => ({
    presetId: 'preset-1',
    speakerLabel: input.speakerKey,
    content: input.id,
    sourceMemoryIds: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...input
})

it('merges aliased profiles into one canonical row', () => {
    const merged = mergeUserProfilesByIdentity(
        [
            profile({
                id: 'qq-profile',
                speakerKey: 'onebot:10001',
                speakerLabel: 'kunfox',
                content: 'QQ 画像',
                sourceMemoryIds: ['memory-qq'],
                platforms: ['qq'],
                updatedAt: new Date('2026-01-02T00:00:00.000Z')
            }),
            profile({
                id: 'weibo-profile',
                speakerKey: 'weibo:20002',
                speakerLabel: 'nogitsune',
                content: '微博画像',
                sourceMemoryIds: ['memory-weibo'],
                platforms: ['weibo'],
                updatedAt: new Date('2026-01-03T00:00:00.000Z')
            })
        ],
        ['kunfox,nogitsune,onebot:10001,weibo:20002']
    )

    assert.equal(merged.length, 1)
    assert.equal(merged[0].speakerLabel, 'kunfox')
    assert.equal(merged[0].content, '微博画像')
    assert.deepEqual(merged[0].sourceMemoryIds, [
        'memory-qq',
        'memory-weibo'
    ])
    assert.deepEqual(merged[0].platforms, ['qq', 'weibo'])
})

it('keeps the canonical profile label when links use speaker keys', () => {
    const merged = mergeUserProfilesByIdentity(
        [
            profile({
                id: 'qq-profile',
                speakerKey: 'qq-key',
                speakerLabel: 'kunfox',
                content: 'QQ 画像',
                sourceMemoryIds: ['memory-qq'],
                platforms: ['qq'],
                updatedAt: new Date('2026-01-02T00:00:00.000Z')
            }),
            profile({
                id: 'weibo-profile',
                speakerKey: 'weibo-key',
                speakerLabel: 'nogitsune',
                content: '微博画像',
                sourceMemoryIds: ['memory-weibo'],
                platforms: ['weibo'],
                updatedAt: new Date('2026-01-03T00:00:00.000Z')
            })
        ],
        ['qq-key,weibo-key']
    )

    assert.equal(merged.length, 1)
    assert.equal(merged[0].speakerLabel, 'kunfox')
    assert.equal(merged[0].content, '微博画像')
})

it('leaves profiles untouched without alias groups', () => {
    const input = [
        profile({ id: 'a', speakerKey: 'onebot:1' }),
        profile({ id: 'b', speakerKey: 'weibo:2' })
    ]
    assert.equal(mergeUserProfilesByIdentity(input), input)
})
