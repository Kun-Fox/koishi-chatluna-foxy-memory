import assert from 'node:assert/strict'
import { withLivingMemoryRepository } from './persistence-test-utils'

it('stores and updates cross-platform identity links per preset', async () => {
    await withLivingMemoryRepository(async (_ctx, repository) => {
        await repository.upsertIdentityLink({
            presetId: 'preset-1',
            platform: 'qq',
            platformUserId: '2242711967',
            canonicalSpeakerKey: 'canonical-a',
            confidence: 0.8,
            source: 'manual'
        })
        await repository.upsertIdentityLink({
            presetId: 'preset-1',
            platform: 'weibo',
            platformUserId: '6200420068',
            canonicalSpeakerKey: 'canonical-a',
            confidence: 0.9,
            source: 'manual'
        })

        const links = await repository.listIdentityLinks('preset-1')
        assert.equal(links.length, 2)
        assert.deepEqual(
            links.map((link) => [
                link.platform,
                link.platformUserId,
                link.canonicalSpeakerKey
            ]),
            [
                ['qq', '2242711967', 'canonical-a'],
                ['weibo', '6200420068', 'canonical-a']
            ]
        )

        await repository.upsertIdentityLink({
            presetId: 'preset-1',
            platform: 'qq',
            platformUserId: '2242711967',
            canonicalSpeakerKey: 'canonical-b',
            confidence: 1,
            source: 'confirmed'
        })
        const updated = await repository.listIdentityLinks('preset-1')
        assert.equal(updated.length, 2)
        assert.equal(
            updated.find((link) => link.platform === 'qq')
                ?.canonicalSpeakerKey,
            'canonical-b'
        )

        await repository.deleteIdentityLink(updated[0].id)
        assert.equal(
            (await repository.listIdentityLinks('preset-1')).length,
            1
        )
        assert.equal(
            (await repository.listIdentityLinks('preset-2')).length,
            0
        )
    })
})
