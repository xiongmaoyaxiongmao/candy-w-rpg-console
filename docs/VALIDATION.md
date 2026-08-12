# v2 验证记录

本页记录此次独立重做的可复现验收边界。没有安装或刷新用户的 SillyTavern，没有访问真实聊天，也没有发送真实模型请求。

## 自动验证

在仓库根目录运行：

```bash
npm run verify
git diff --check
```

本次 `npm run verify` 覆盖并通过 **94 个测试**，包括：严格剧本 schema/哈希/引用图、7 个场景与 5 个结局可达、固定时钟与错过事件、NPC 幕后 agenda、公开判定与不可重投、导演状态机、隐藏投影、协议与上下文预算、per-chat repository、严格导入导出、架构/secret/path scan、UI controller/renderer，以及真实 application + repository + fake official adapter 行为链。

fake official adapter 行为链包括空白与已有聊天、自由行动自动推进、跨时钟、投骰分支、隐藏理解失败、可见演出失败、所属事务停止、无关全局停止隔离、隐藏理解停止、刷新恢复、切聊隔离、禁用清理、Candy W 群聊命令拒绝但不干扰原生群聊、并发隔离、流式完成后不反向锁死宿主 UI，以及普通/自动主演出启用工具调用时的失败关闭。它还覆盖原生 `main_chat` clone：同角色的新检查点/分支聊天只接管来源当时已提交的 `state/scenario`，重绑目标 chat identity 后独立推进；目标 runtime cursor 重新建立，来源 operation/pending transaction 绝不继承，未完成来源事务会被拒绝接管。

新增的 owned-request 测试还验证：隐藏理解中切聊先 `abort(true)`、已准备演出切聊请求 stop、身份不匹配的流式 token 请求 stop、禁用/卸载在拆 hook 前停止请求、旧聊天保留恢复点、新聊天不写 fake metadata/回复。SillyTavern 1.18.0 的常规角色切换、聊天历史和新建聊天 UI 都会在 `is_send_press` 期间拒绝操作，但检查点旗标、检查点返回主聊天与旧消息创建分支仍是可见的无守卫路径。测试中的直接切聊验证这类路径一旦发生后扩展的失败关闭；正式 API 在 `CHAT_CHANGED` 之前仍没有请求绑定提交能力。非流式回复恰好在该观察点前写入核心的极窄时序无法由 fake adapter 或正式插件 API 消除；它作为宿主使用限制记录在源码证据页，不是源码提交、推送或发布否决。

## 视觉验证

视觉页 [`tests/ui-harness.html`](../tests/ui-harness.html) 使用生产 `DirectorUi`、`DirectorApplication`、`PerChatRepository` 与完整内置剧本；只有宿主事件和模型返回由测试目录中的 fake official adapter 代替。页面状态通过真实命令和状态机抵达，不直接塞入手写 view state。

已检查桌面 `1280×720` 与手机 `390×844`。手机关键流程无横向溢出，主要触控目标不小于约 `47.5px`；检查了首次进入、选剧本、玩家设定、开场、进行中、已知世界、章节、等待判定、骰后生成、错误恢复和结局。关键截图位于本目录的 `visual-evidence/`。

## 尚未完成的验收

- 尚未安装到用户真实 SillyTavern。
- 尚未以真实角色卡、真实世界书、真实模型连接或流式供应商进行酒馆验收。
- SillyTavern 1.18.0 缺少切聊前置/请求绑定提交接口；检查点和旧消息分支等正常可见入口可绕过生成锁。生成中主动经这些入口切换时，存在一个无法由扩展完全消除的迟到非流式回复时序；正常使用应等待生成结束。这是已记录的宿主限制，不是源码发布否决。流式首次显示前全文审查与磁盘 durability acknowledgement 也受正式 API 限制。见 [`SILLYTAVERN-1.18.0-EVIDENCE.md`](SILLYTAVERN-1.18.0-EVIDENCE.md)。
