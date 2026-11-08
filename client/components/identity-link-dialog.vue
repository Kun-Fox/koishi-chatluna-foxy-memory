<template>
    <el-dialog
        :model-value="modelValue"
        title="身份合并"
        width="760px"
        :close-on-click-modal="false"
        @update:model-value="emit('update:modelValue', $event)"
        @open="loadLinks"
    >
        <div class="identity-merge-layout">
            <section class="identity-main-card">
                <div class="identity-main-kicker">主账号</div>
                <h3 class="identity-main-name">
                    {{ profile.speakerLabel }}
                </h3>
                <div
                    v-if="profile.platforms?.length"
                    class="identity-platforms"
                >
                    <span
                        v-for="platform in profile.platforms"
                        :key="platform"
                        class="identity-platform-tag"
                    >
                        {{ platformLabel(platform) }}
                    </span>
                </div>
                <p class="identity-main-key">
                    {{ profile.speakerKey }}
                </p>
                <p class="identity-hint">
                    只合并你在这里手动关联的账号。系统不会按昵称自动匹配。
                </p>
            </section>

            <section class="identity-links-panel">
                <div class="identity-panel-title">已关联账号</div>
                <el-empty
                    v-if="canonicalLinks.length === 0 && !loading"
                    description="还没有关联其他平台账号"
                    :image-size="48"
                />
                <ul v-else class="identity-link-list">
                    <li
                        v-for="link in canonicalLinks"
                        :key="link.id"
                        class="identity-link-row"
                    >
                        <div>
                            <strong>{{ platformLabel(link.platform) }}</strong>
                            <span class="identity-link-id">
                                {{ link.platformUserId }}
                            </span>
                        </div>
                        <el-button
                            link
                            type="danger"
                            :loading="deletingId === link.id"
                            @click="removeLink(link)"
                        >
                            移除
                        </el-button>
                    </li>
                </ul>

                <div class="identity-add-form">
                    <div class="identity-panel-title">从已有账号中选择</div>
                    <p class="identity-hint">
                        搜索本预设中已出现的账号；点击后加入左侧主账号。
                    </p>
                    <el-input
                        v-model="speakerQuery"
                        placeholder="搜索昵称、平台或账号 ID"
                        clearable
                    />
                    <div class="identity-speaker-list">
                        <button
                            v-for="speaker in filteredSpeakers"
                            :key="speaker.speakerKey"
                            type="button"
                            class="identity-speaker-row"
                            :disabled="saving"
                            @click="addSpeaker(speaker)"
                        >
                            <span>
                                <strong>{{ speaker.speakerLabel }}</strong>
                                <small>
                                    {{ platformLabel(speaker.platform || 'other') }}
                                    · {{ speaker.speakerId || speaker.speakerKey }}
                                </small>
                            </span>
                            <span class="identity-speaker-add">加入</span>
                        </button>
                        <p
                            v-if="filteredSpeakers.length === 0"
                            class="identity-hint"
                        >
                            没有可加入的账号
                        </p>
                    </div>
                </div>

                <div class="identity-add-form">
                    <div class="identity-panel-title">手动添加平台账号</div>
                    <p class="identity-hint">
                        输入同一人的其他平台账号 ID；关联后画像会合并展示。
                    </p>
                    <div class="identity-add-row">
                        <el-select
                            v-model="newPlatform"
                            class="identity-platform-select"
                        >
                            <el-option
                                v-for="platform in platformOptions"
                                :key="platform.value"
                                :label="platform.label"
                                :value="platform.value"
                            />
                        </el-select>
                        <el-input
                            v-model="newPlatformUserId"
                            placeholder="平台账号 ID"
                            clearable
                            @keyup.enter="addLink"
                        />
                        <el-button
                            type="primary"
                            :loading="saving"
                            :disabled="!newPlatformUserId.trim()"
                            @click="addLink"
                        >
                            添加
                        </el-button>
                    </div>
                </div>
            </section>
        </div>
    </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '../api'
import type {
    IdentityLinkRecord,
    PresetSpeakerRecord,
    UserProfileRecord
} from '../../src/contracts/memory'

const props = defineProps<{
    modelValue: boolean
    presetId: string
    profile: UserProfileRecord
}>()

const emit = defineEmits<{
    'update:modelValue': [value: boolean]
    saved: []
}>()

const platformOptions = [
    { label: 'QQ', value: 'qq' },
    { label: '微博', value: 'weibo' },
    { label: 'B站', value: 'bilibili' },
    { label: 'DSH', value: 'dsh' },
    { label: '其他', value: 'other' }
]

const platformLabels: Record<string, string> = Object.fromEntries(
    platformOptions.map((item) => [item.value, item.label])
)

const platformLabel = (platform: string) =>
    platformLabels[platform] ?? platform

const links = ref<IdentityLinkRecord[]>([])
const speakers = ref<PresetSpeakerRecord[]>([])
const speakerQuery = ref('')
const loading = ref(false)
const saving = ref(false)
const deletingId = ref<string | null>(null)
const newPlatform = ref('qq')
const newPlatformUserId = ref('')

const canonicalLinks = computed(() =>
    links.value.filter(
        (link) => link.canonicalSpeakerKey === props.profile.speakerKey
    )
)

const filteredSpeakers = computed(() => {
    const query = speakerQuery.value.trim().toLocaleLowerCase()
    const linked = new Set(
        canonicalLinks.value.map(
            (link) => `${link.platform}:${link.platformUserId}`
        )
    )
    return speakers.value
        .filter((speaker) => speaker.speakerKey !== props.profile.speakerKey)
        .filter((speaker) => {
            const platform = speaker.platform || 'other'
            const accountId = speaker.speakerId || speaker.speakerKey
            return !linked.has(`${platform}:${accountId}`)
        })
        .filter((speaker) => {
            if (!query) return true
            return [
                speaker.speakerLabel,
                speaker.speakerKey,
                speaker.speakerId || '',
                speaker.platform || ''
            ]
                .join(' ')
                .toLocaleLowerCase()
                .includes(query)
        })
        .slice(0, 30)
})

const loadLinks = async () => {
    if (!props.presetId) {
        links.value = []
        speakers.value = []
        return
    }
    loading.value = true
    try {
        ;[links.value, speakers.value] = await Promise.all([
            api.listIdentityLinks(props.presetId),
            api.listPresetSpeakers(props.presetId)
        ])
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ElMessage.error(`获取身份关联失败：${message}`)
    } finally {
        loading.value = false
    }
}

watch(
    () => props.modelValue,
    (visible) => {
        if (visible) {
            newPlatformUserId.value = ''
            void loadLinks()
        }
    }
)

const addSpeaker = async (speaker: PresetSpeakerRecord) => {
    const platform = speaker.platform || 'other'
    const platformUserId = speaker.speakerId || speaker.speakerKey
    saving.value = true
    try {
        await api.upsertIdentityLink({
            presetId: props.presetId,
            platform,
            platformUserId,
            canonicalSpeakerKey: props.profile.speakerKey,
            source: 'manual'
        })
        ElMessage.success('已加入关联账号')
        await loadLinks()
        emit('saved')
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ElMessage.error(`添加失败：${message}`)
    } finally {
        saving.value = false
    }
}

const addLink = async () => {
    const platformUserId = newPlatformUserId.value.trim()
    if (!platformUserId) return
    saving.value = true
    try {
        await api.upsertIdentityLink({
            presetId: props.presetId,
            platform: newPlatform.value,
            platformUserId,
            canonicalSpeakerKey: props.profile.speakerKey,
            source: 'manual'
        })
        newPlatformUserId.value = ''
        ElMessage.success('已添加关联账号')
        await loadLinks()
        emit('saved')
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ElMessage.error(`添加失败：${message}`)
    } finally {
        saving.value = false
    }
}

const removeLink = async (link: IdentityLinkRecord) => {
    try {
        await ElMessageBox.confirm(
            `移除 ${platformLabel(link.platform)} / ${link.platformUserId} 的关联？画像将不再合并该账号。`,
            '移除身份关联',
            {
                type: 'warning',
                confirmButtonText: '移除',
                cancelButtonText: '取消'
            }
        )
    } catch {
        return
    }

    deletingId.value = link.id
    try {
        await api.deleteIdentityLink(link.id)
        ElMessage.success('已移除关联')
        await loadLinks()
        emit('saved')
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ElMessage.error(`移除失败：${message}`)
    } finally {
        deletingId.value = null
    }
}
</script>

<style scoped>
.identity-merge-layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 18px;
}

.identity-main-card,
.identity-links-panel {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 10px;
    padding: 16px;
    background: var(--el-fill-color-blank);
}

.identity-main-card {
    align-self: start;
    background: var(--el-fill-color-light);
}

.identity-main-kicker,
.identity-panel-title {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    letter-spacing: 0.04em;
}

.identity-main-name {
    margin: 8px 0;
    font-size: 20px;
}

.identity-platforms {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
}

.identity-platform-tag {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-size: 12px;
}

.identity-main-key {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 11px;
    word-break: break-all;
}

.identity-hint {
    margin: 10px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.5;
}

.identity-link-list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
}

.identity-link-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--el-border-color-lighter);
}

.identity-link-row:last-child {
    border-bottom: none;
}

.identity-link-id {
    margin-left: 8px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
}

.identity-speaker-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 220px;
    margin-top: 10px;
    overflow: auto;
}

.identity-speaker-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 9px 10px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-fill-color-blank);
    color: inherit;
    text-align: left;
    cursor: pointer;
}

.identity-speaker-row:hover {
    border-color: var(--el-color-primary-light-5);
    background: var(--el-color-primary-light-9);
}

.identity-speaker-row small {
    display: block;
    margin-top: 3px;
    color: var(--el-text-color-secondary);
    font-size: 11px;
}

.identity-speaker-add {
    flex: none;
    color: var(--el-color-primary);
    font-size: 12px;
}

.identity-add-form {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--el-border-color-lighter);
}

.identity-add-row {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr) auto;
    gap: 8px;
    margin-top: 10px;
}

.identity-platform-select {
    width: 100%;
}

@media (max-width: 720px) {
    .identity-merge-layout {
        grid-template-columns: 1fr;
    }
}
</style>
