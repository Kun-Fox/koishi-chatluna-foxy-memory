# koishi-plugin-chatluna-foxy-memory

Foxy 的跨平台长期记忆插件。以 Koishi + ChatLuna + Character 为 QQ 侧入口，同时为 DSH、微博、B站等外部平台预留统一记忆来源与用户身份。

> 状态：**公测版（已在本机 Koishi 实例接管）**。本仓库 fork 了 LivingMemory 的完整 MIT 源码作为兼容底座；平台筛选、身份链接、画像合并、DSH HTTP 直连、迁移用导出/导入、DSH 记忆 UI、记忆列表实时刷新均已可用。Dream/向量索引继承原项目单写者队列；大规模迁移前仍应先备份 `koishi.db` 与向量目录。

## 与 LivingMemory 的关系

- LivingMemory 的长期记忆、Dream、快照、用户画像、向量索引、Console 页面与 ChatLuna/Character 接入，均在 `src/` 中保留。
- 本项目不是 LivingMemory 的运行时依赖；源码级 fork 便于逐项扩展和迁移。
- LivingMemory 将不再作为 Foxy 的长期依赖。迁移完成后，旧插件只保留只读备份。
- 灵感与基础实现来自 [Procyon-Nan/koishi-plugin-chatluna-livingmemory](https://github.com/Procyon-Nan/koishi-plugin-chatluna-livingmemory)，MIT License，原作者署名保留在 `package.json` 与 `LICENSE`。

## 目标能力

- 全部保留 LivingMemory 的记忆提取、召回、快照、用户画像、Dream、工具与 Console 配置页。
- 记忆按平台/来源筛选；同一用户跨平台合并为统一画像，并展示来源平台。
- 结构化 `FoxyMemoryEvent`，避免把“被 @ 后回复”写成“我刷到”。
- DSH 与 QQ 侧双向读写，旧 memory bridge 可退役。
- 两端记忆热更新、实时刷新与单写者事务；Console 记忆列表每 30 秒自动刷新，外部写入无需重启。
- 为微博、B站、未来平台保留适配器接口。

详细需求矩阵、架构、迁移与风险见：

- [需求与实施矩阵](docs/foxy-memory-requirements.md)
- [LivingMemory 原文档](https://github.com/Procyon-Nan/koishi-plugin-chatluna-livingmemory)

## 安装（开发版）

```bash
# 在 Koishi 实例根目录
corepack yarn add koishi-plugin-chatluna-foxy-memory
```

构建：

```bash
npm install
npm run build
```

启用后，在 Koishi Console 左侧进入 **Foxy Memory** 页面。命令行入口为 `foxy-memory`；旧服务名仅作为兼容别名保留。

### 在预设中加入记忆变量

本插件只提供记忆服务，不替换 ChatLuna 或 Character 的预设。记忆不是通过 URL 写进预设，而是通过预设变量注入：

- **ChatLuna**：主对话由插件在 `before-chat` 自动注入记忆，预设里不需要额外变量。
- **Character**：在预设的 system / prompt 文本中加入 `{living_memory}`，插件会把本轮的长期记忆和用户画像替换到这个位置。推荐放在人设之后、当前对话之前：

```yaml
persona: |
  你是 Foxy……

  {living_memory}

  以下是当前对话：
```

`{living_memory}` 是变量占位符，不是 HTTP 地址，也不是本机端口。DSH 侧的 `bridgeUrl` 才填写 `http://127.0.0.1:5140/foxy-memory`；两者不要混淆。Character 预设即使没有这个变量，插件也会在 `before-chat` 准备上下文，但显式加入变量才能控制注入位置，也更便于排查。

## 配置

模型、提取、召回、Dream、用户画像、工具、白名单等配置沿用 LivingMemory 的完整 Schema；平台筛选、身份合并、DSH HTTP API 与迁移导入导出已加入当前版本。

当前已加入：

- 记忆列表的“平台来源”筛选（QQ / 微博 / B站 / DSH）。
- 记忆记录从 `sourceConversationId` 派生平台，不依赖旧 `sourceLabel` 字段。
- 跨平台身份别名：配置 `identityAliases`，每项用逗号分隔，首项为统一展示名，例如 `用户,nogitsune,小狐狸`。Console 画像页的“身份合并”可按已有账号搜索并手动加入，默认不自动合并；画像注入按统一身份合并展示，数据库中的画像记录仍保留原 speakerKey，便于回溯。
- DSH / 跨平台 HTTP API（默认关闭）：开启 `foxyApiEnabled` 后提供 `/foxy-memory/health`、`/record`、`/ingest`、`/context`、`/list`、`/search`、`/presets`，以及用于迁移的 `/export`、`/import`。`foxyApiToken` 留空时只允许本机访问；跨机调用必须设置 Bearer Token。默认写入 `foxyApiDefaultPresetId`（默认 `preset（Character）`）。
- 迁移旧数据：先用 `GET /foxy-memory/export?presetId=<旧池>` 导出 JSON，再用 `POST /foxy-memory/import`（body `{targetPresetId,data}`）导入新池；导入会保留记忆正文、类型、关键词、来源、时间与画像，并重建向量索引。

### DSH 接入

DSH 侧仍使用 `dsh-foxy-memory`，把 `bridgeUrl` 指向本插件的 `/foxy-memory` 即可：

```json
{
  "provider": "livingmemory",
  "bridgeUrl": "http://127.0.0.1:5140/foxy-memory",
  "bridgeToken": "",
  "bridgePresetId": "preset（Character）"
}
```

`/ingest` 兼容旧 bridge 的 `messages[]`、`sessionId`、`platform`、`channelType`、`channelId`、`eventType`、`sourceLabel` 字段；`/context` 同时返回 `text` 与 `memories`，兼容 DSH provider 的旧读取方式。

## 迁移原则

1. 旧 LivingMemory 表与向量目录只读扫描；
2. 先生成身份匹配候选，不自动合并；
3. 迁移保留原 ID、时间、来源、embedding；
4. 双写/对账通过后再停用旧插件；
5. 迁移脚本必须可回滚，禁止删除旧表。

## 风险

- 跨平台身份合并错误会污染用户画像，必须人工确认。
- 热更新需要单写者队列，不能让文件监听直接写 PGlite。
- Dream 全量迁移成本可能很高，需要预算与限流。
- 旧数据中已存在错误来源文案，迁移时应标记为 `legacy`。

## License

MIT。基础代码版权归 ProcyonNAN；Foxy 扩展部分归 Kun-Fox。
