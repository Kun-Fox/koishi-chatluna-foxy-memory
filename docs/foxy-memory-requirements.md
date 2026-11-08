# Foxy Memory 需求与实施矩阵

> 状态：**公测版（已在本机实例接管）**。本文件逐条对应用户提出的 15 项要求；平台筛选、身份链接、画像合并、DSH HTTP 直连、迁移导出/导入、DSH 记忆 UI 与列表热刷新已落地，正在做迁移对账与全量回归。
> 本仓库当前以 `koishi-plugin-chatluna-livingmemory` 的 MIT 源码为兼容底座；`LivingMemory` 已停止作为长期依赖，仅保留迁移与对照用途。

## 0. 总体结论

这不是一个“加几个字段”的插件，而是把一套已经运行了 31 个版本的记忆系统从“预设内聊天记忆”扩展为“跨平台身份记忆中枢”。本次交付以 fork 为底座，先保证原功能、数据与 ChatLuna/Character 接入不变，再逐项加平台、身份、DSH 直连与迁移能力。

## 1. 功能矩阵

| # | 要求 | 设计 | 当前状态 |
|---|------|------|----------|
| 1 | 完整保留 LivingMemory 全部功能与 Console 配置页 | 以 MIT 源码 fork 为底座，保留原服务、命令、工具、Dream、向量索引、WebUI | 已 fork；包名/Console 入口已改；构建/类型检查通过；插件已接管本机实例，基础回归通过 |
| 2 | 平台筛选 + 用户匹配 | `sourceConversationId` 派生 `platform`；新增身份链接表 `foxy_identity_link` | 平台派生/筛选、身份链接表、Repository、RPC、画像卡片“身份合并”对话框已完成；默认不自动匹配，只合并人工添加的账号 |
| 3 | 跨平台记忆整合进用户画像，画像显示来源平台 | 以 `canonicalSpeakerKey` 聚合 profile；profile 记录来源平台集合 | 画像列表与提示注入均读取 `identity_links` 合并；卡片显示来源平台；画像记录级持久合并保留原 speakerKey |
| 4 | 预设 ID 选择保持不变 | 保留原 `presetId` 作用域 | 保留 |
| 5 | Koishi 设置只管 QQ 侧 | 新插件不读写 `~/.dsh/foxy`；DSH 侧由 `dsh-foxy-memory` 自管 | 已按独立 `koishi.yml` 配置运行；未读写 `~/.dsh/foxy` |
| 6 | 更高效存储 + 全量迁移 | 保留 Koishi DB + PGlite 向量索引；新增平台/身份列与迁移任务；导出/导入校验 | 同库兼容接管，682 条现有记忆保留；`/export` 实测；`/import` 已实现，完整对账待执行 |
| 7 | 适配 DSH foxy-memory / foxy-daily、ChatLuna / Character | 统一 `MemoryEvent` HTTP/服务契约；QQ 侧适配器作为独立子插件 | `/foxy-memory/record|ingest|context|list|search|export|import` 已运行；DSH provider 已可直连；foxy-daily 端到端待验证 |
| 8 | DSH ↔ QQ 直接往返，可舍弃旧 bridge | 新插件暴露 `/foxy-memory/*`；DSH provider 直连；旧 bridge 仅保留迁移兼容 | 新插件已接管 5140；旧 bridge 已从配置移除；DSH→QQ 已通，QQ→DSH 写入待联调 |
| 9 | `dsh-foxy-memory` 重做为同等 UI | DSH 设置页增加平台/来源/写入状态/调试；QQ 侧不反向管理 | `dsh-foxy-memory@0.4.0` 已加侧栏、平台筛选、搜索/归档与 `/api/dsh-foxy-memory/*` |
| 10 | 两端热读写、实时刷新、不冲突 | 文件/DB 变更监听 + 版本号 + 单写者队列；冲突检测 | 记忆列表 30 秒自动刷新；PGlite 单写者；冲突检测仅覆盖索引锁，跨端写入对账待补 |
| 11 | 逐项核对 LivingMemory 全部代码 | 以 `src/` 130 文件为审计基线，建立功能清单 | 源码基线、构建与关键测试通过；逐项人工审计进行中 |
| 12 | 提出隐患与可完善点 | 见“风险”章节 | 初版已完成 |
| 13 | 修改相关插件 README，声明 LivingMemory 退役与灵感来源 | 本仓库 README + 各 dsh-foxy README | 本仓库与 dsh-foxy 系列 README 已完成 |
| 14 | 为未来平台留设计空间 | 平台注册表 + `MemoryEvent` + adapter 接口 | `platform/channelType/channelId/eventType` 已贯通；新增平台只需扩展派生规则 |
| 15 | 反复检查，一项不漏 | 以本矩阵为验收清单，逐项测试 | 已完成构建、类型检查、关键测试与真实实例接管；迁移对账/全量回归见开放项 |

## 2. 关键设计

### 2.1 作用域

```
presetId            身份/记忆池（不变）
platform            来源平台：qq / weibo / bilibili / dsh / ...
channelType         private / group / post / video / ...
channelId           平台内会话或内容 ID
canonicalSpeakerKey 跨平台合并后的用户主键
```

### 2.2 记忆事件

所有平台都不再“拼一句提示词让模型猜”，而是提交结构化事件：

```ts
interface FoxyMemoryEvent {
  platform: string
  channelType: string
  channelId: string
  eventType:
    | 'chat_message'
    | 'browse'
    | 'post_read'
    | 'comment_received'
    | 'reply_sent'
    | 'private_push'
  occurredAt: string
  actor: { platformId: string; displayName: string }
  title?: string
  url?: string
  content: string
  raw?: unknown
}
```

显式事件直接 `createMemory`；只有聊天记录才进入通用提取。这样不会再把“被 @ 后回复”改写成“我刷到”。

### 2.3 身份匹配

新增 `foxy_identity_link`：

```
presetId, platform, platformUserId, canonicalSpeakerKey, confidence, source, createdAt
```

合并规则：

1. 人工确认优先；
2. 同平台同 ID 自动；
3. 跨平台昵称/显式声明只作为候选，不自动合并；
4. 合并后画像按 canonical 聚合，保留每个原始 speakerKey 的来源平台。

### 2.4 存储

- 元数据/画像/任务：Koishi 数据库（SQLite/MySQL/Postgres）。
- 向量：PGlite + pgvector，保留原目录所有权与重建能力。
- 记忆正文：不引入第二套 JSONL 作为主存储；DSH 侧缓存只做离线队列。
- 热更新：单写者队列 + `updatedAt`/revision；文件监听只触发刷新，不直接写库。

### 2.5 DSH HTTP 兼容层

`src/plugins/foxy_api.ts` 提供与旧 `foxy-memory-bridge` 同路径的接口：

- `GET /foxy-memory/health`
- `POST /foxy-memory/record`
- `POST /foxy-memory/ingest`
- `POST /foxy-memory/context`

请求支持 `presetId`、`sessionId`、`conversationId`、`platform`、`channelType`、`channelId`、`eventType`、`sourceLabel`、`messages[]`。`/context` 同时返回 `text` 与 `memories`，因此 `dsh-foxy-memory` 的旧 provider 可以直接指向本插件，无需旧 bridge 进程。

安全默认：`foxyApiEnabled` 默认关闭；开启后 `foxyApiToken` 为空时只接受本机回环请求。跨机部署必须配置 Bearer Token。

## 3. 迁移

1. 只读扫描旧 `living_memory_*` 表与向量目录；
2. 生成 `foxy_identity_link` 候选（平台 + speakerKey）；
3. 按 `presetId` 导出/导入，校验条数、ID、来源、 embedding 维度；
4. 双写一段时间，旧插件只读；
5. 确认后停用 LivingMemory，保留只读备份。

迁移必须支持回滚；禁止在迁移中删除旧表。

## 4. 风险

- **画像合并不可逆**：错误合并会把两个人的记忆写进一个画像；必须先候选、后人工确认。
- **跨平台身份不可靠**：昵称相同不代表同一人；不能仅凭 LLM 判断自动合并。
- **热更新冲突**：PGlite 单写者 + 外部文件监听容易写坏索引；必须队列化。
- **Dream 成本**：全量迁移后一次 Dream 可能非常贵；需要限流/预算。
- **UI 复杂度**：原 WebUI 已很大，新增平台/身份页要避免把主流程做成配置迷宫。
- **DSH/QQ 双端循环**：直接往返若没有幂等键，会重复写记忆。
- **旧数据污染**：当前 LivingMemory 已有错误“我记得在 DSH 私聊里”条目，迁移时应标记 `legacy: true`，不要当真实来源。

## 5. 分阶段

### Phase 0（本仓库当前）
- fork 源码、保留全部功能；
- 平台派生与记忆列表筛选；
- 需求矩阵/架构/风险文档；
- 不发布、不替换旧插件。

### Phase 1（当前）
- `foxy_identity_link` 表、人工匹配 UI 已完成；
- 画像列表与提示注入均已按人工链接合并；
- 平台筛选覆盖记忆/画像；任务筛选与迁移/只读校验仍待完成。

### Phase 2
- `MemoryEvent` 服务与 HTTP API；
- ChatLuna/Character 适配器；
- DSH provider 直连，旧 bridge 降级为兼容层。

### Phase 3
- 画像合并、来源平台展示；
- 两端热更新/冲突检测；
- 全量回归、迁移演练、发布。

## 6. 验收

已在 `0.1.2` 本机实例完成：

- `GET /foxy-memory/health` 返回 `service=chatluna-foxy-memory`、`preset=foxy3（Character）`；
- `POST /foxy-memory/list|search|context` 返回真实记忆，`/search` 返回微博命中；
- `GET /foxy-memory/export` 导出 682 条现有记忆；
- 身份合并 Console 对话框可打开，支持已有账号搜索、平台/账号 ID 添加、移除确认；
- 记忆列表 30 秒自动刷新；
- 插件构建、类型检查与 `identity-link-repository`、`profile-identity`、`preset-import-export` 测试通过。

仍待验收（发布前未完全自动化）：

- 旧库迁移前后条数/内容/向量逐条对账；
- 同一用户跨平台画像在真实数据上的生成与来源平台展示；
- DSH 写入 → QQ 召回、QQ 写入 → DSH 召回的双向实测；
- 两端同时写入不产生重复/丢失；
- 断网/重启后队列恢复；
- 任何自动合并都可撤销。

以上待验收项不阻塞当前公测版使用；大规模迁移前必须先备份 `koishi.db` 与向量目录。
