# Candy W 跑团控制台（SillyTavern 首版试玩）

这是一个独立、轻量的 SillyTavern 第三方扩展，用来先试玩 Candy W 需要的单人 AI 主持跑团体验。它不生成剧情、不审查内容、不替换模型，也不复制角色卡或 World Info。

## 安装与启用

将整个 `candy-w-rpg-console` 文件夹放到：

```text
SillyTavern/public/scripts/extensions/third-party/candy-w-rpg-console
```

刷新 SillyTavern，在扩展设置里确认“Candy W 跑团控制台”已启用。本仓库发布包不包含用户酒馆数据，也不会自动连接或上传聊天内容。

也可以在 SillyTavern 的“安装扩展”输入框直接粘贴：

```text
https://github.com/xiongmaoyaxiongmao/candy-w-rpg-console
```

## 当前能玩的流程

1. 打开一个角色聊天，点击右下角“🎲 跑团”。
2. 在“状态”页填写团名、场景、目标、角色名、体力和意志。
3. 在“掷骰”页用 `d20`、`2d6+1` 这类公式公开掷骰，可选难度并留下成功/失败记录。
4. 在普通聊天输入行动，让当前模型继续主持；控制台会通过 SillyTavern 官方 `setExtensionPrompt` 注入一份紧凑状态。
5. 在“记录”页手动加入线索、物品和重要 NPC。换聊天时数据跟着聊天切换。
6. 需要暂停时关闭“注入当前团状态”；仍可继续记录和掷骰。可从底部导出/导入 JSON。

## 边界与验证

- 状态保存在当前聊天 metadata，普通聊天消息不被改写；没有 DOM/fetch 拦截，也没有关键词成人内容判定。
- 关闭注入时会把本扩展的官方上下文槽清空；不触碰 World Info、角色卡、预设或其他扩展。
- 本地验证包括 Node 语法检查、纯逻辑单元测试、manifest/schema 检查、Git diff 检查和桌面/窄屏视觉 fixture 检查；未连接用户酒馆。

## 后续值得迁入 Candy W 的体验

优先观察：玩家是否愿意手动维护少量状态、骰子记录是否真的增加信任感、AI 主持是否能稳定利用紧凑状态、导出/导入是否足以让玩家安心。地图、多人、自动裁决和复杂规则应等真实试玩证明需要后再做。
