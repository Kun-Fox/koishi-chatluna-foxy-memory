# koishi-plugin-chatluna-foxy-memory

Foxy 的跨平台长期记忆插件。以 Koishi + ChatLuna + Character 为 QQ 侧入口，同时为 DSH、微博、B站等外部平台预留统一记忆来源与用户身份。

> 状态：**设计/基础阶段**。本仓库已经 fork LivingMemory 的完整 MIT 源码作为兼容底座，但跨平台身份、画像合并、DSH 直连与热更新仍在实施中。不要把当前版本当作 LivingMemory 的完整替代品直接上线。

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
- 两端记忆热更新、实时刷新、冲突检测。
- 为微博、B站、未来平台保留适配器接口。

详细需求矩阵、架构、迁移与风险见：

- [需求与实施矩阵](docs/foxy-memory-requirements.md)
- [LivingMemory 原文档](https://github.com/Procyon-Nan/koishi-plugin-chatluna-livingmemory)

## 安装（开发版）

```bash
# 在 Koishi 实例根目录
corepack yarn add "koishi-plugin-chatluna-foxy-memory@file:./koishi-plugin-chatluna-foxy-memory"
```

构建：

```bash
npm install
npm run build
```

启用后，在 Koishi Console 左侧进入 **Foxy Memory** 页面。原 LivingMemory 页面路径/命令仍保留兼容。

## 配置

模型、提取、召回、Dream、用户画像、工具、白名单等配置沿用 LivingMemory 的完整 Schema。新增平台/身份配置将在后续阶段加入。

当前已加入：

- 记忆列表的“平台来源”筛选（QQ / 微博 / B站 / DSH）。
- 记忆记录从 `sourceConversationId` 派生平台，不依赖旧 `sourceLabel` 字段。
- 跨平台身份别名：配置 `identityAliases`，每项用逗号分隔，首项为统一展示名，例如 `kunfox,nogitsune,小狐狸`。画像注入按统一身份合并展示；数据库中的画像记录仍保留原 speakerKey，便于回溯。

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
