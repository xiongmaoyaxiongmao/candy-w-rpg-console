# SillyTavern 1.18.0 正式接口证据

核验对象是本机 `SillyTavern` 1.18.0 源码。该源码树原本已有其他改动；本次只读检查，没有安装、启动、刷新或请求真实模型。

## 普通发送与隐藏导演决策

- `public/script.js:4231-4262`：`Generate()` 发出 `GENERATION_STARTED` / `GENERATION_AFTER_COMMANDS`。
- `public/script.js:4337-4399`：普通发送读取输入并调用 `sendMessageAsUser()`。
- `public/script.js:5815-5863`：用户消息先保存，再发出 awaited `MESSAGE_SENT`。
- `public/script.js:4401-4511`：角色字段与聊天上下文形成后，运行扩展 generation interceptors。
- `public/scripts/extensions.js:2015-2039`：manifest `generate_interceptor` 按 loading order 逐个 await，且可 `abort(true)` 阻止主演出请求。
- `public/script.js:4560-4577`：interceptor 完成后才进行原生 World Info 扫描。

因此 v2 使用正式 `generate_interceptor`：此时玩家自由行动已成为正常聊天消息，但主演出模型尚未请求。隐藏行动理解通过 `getContext().generateRaw()` 使用当前连接；严格 JSON 校验失败时整个普通生成中止，不把无效决定伪装成完成。

`generateQuietPrompt()` 会重入完整 `Generate('quiet')`（`public/script.js:3025-3052`），不适合作为 interceptor 内的嵌套导演请求。`generateRaw()` 才是只返回文本、不写聊天的正式接口（`public/script.js:3941-4091`）。SillyTavern 的 `jsonSchema` 支持并非所有主 API 等价（`public/script.js:6252-6306`），所以插件不依赖它，而是在本地执行模型无关的严格 JSON/schema 校验。

## 正式回复与事务提交

- 非流式：`public/script.js:5421-5523` 先 `saveReply()`，再执行最终聊天保存；`public/script.js:6683-6724` 在最终保存前 await `MESSAGE_RECEIVED`。
- 流式：`public/script.js:3584-3759` 完整消息结束时 await `MESSAGE_RECEIVED`，随后执行最终聊天保存。
- `public/script.js:7336-7388`：聊天 metadata 与消息共同组成 JSONL 保存内容。
- `src/endpoints/chats.js:457-483`：服务端保存完整聊天数组。
- `src/util.js:1491-1498`：文件写入使用 `write-file-atomic`。

v2 在 interceptor 阶段先持久化 pending transaction；在对应 `MESSAGE_RECEIVED` 内验证回复、确定性应用已准备的导演结果，并只把新 metadata staged 到当前聊天对象。随后由 SillyTavern 自己的最终保存把正式回复与提交后的导演状态写进同一 JSONL。

事件表没有 `GENERATION_FAILED`（`public/scripts/events.js:22-25`）。`GENERATION_ENDED` 只表示 stop button 被隐藏（`public/script.js:3469-3478`），不能独自代表成功。v2 同时检查 STOPPED、pending transaction、聊天身份、预期消息、流式处理器状态和完整回复。

工具调用有一条不同的正式时序：普通非流式生成在 `public/script.js:5477-5502` 先 `saveReply()` 并发出 `MESSAGE_RECEIVED`，之后才判断、执行工具并递归生成；流式对应 `public/script.js:5353-5381`。真正的工具调用记录更晚才由 `public/scripts/tool-calling.js:887-908` 写为独立 system message。因此 1.18.0 没有让扩展在首次回复提交前可靠识别“这其实是工具中间回复”的正式 hook。v2 在任何导演主演出前调用 `getContext().canPerformToolCalls('normal')`；若当前普通生成启用了工具调用，就失败关闭并保留可恢复事务，要求用户关闭工具调用后重试。它不会让工具递归绕出导演事务，也不会私自修改用户的工具设置。

## 原生 World Info scan seed

- `public/script.js:480-499`：正式 prompt position 含 `NONE = -1`。
- `public/script.js:8856-8874`：`setExtensionPrompt()` 正式保存 `scan` 标志。
- `public/scripts/world-info.js:4597-4614`：所有 `scan=true` 的扩展提示会进入原生扫描 buffer。
- `public/scripts/world-info.js:4363-4475`：扫描对象只来自当前激活的全局、角色、聊天与 persona lore。
- `public/scripts/world-info.js:4673-4957`：seed 仍经过原生 disable、trigger、角色过滤、constant、key/selective、概率、sticky 与预算规则。

v2 使用两个独立槽：演出指令为正常 prompt 且 `scan=false`；当前场景的公开人名、地点、组织和事件锚点为 `NONE + scan=true`。后一个槽只触发原生扫描，不直接复制世界书内容或另造优先级；隐藏秘密与未来节点永不进入 seed。

## 已知正式边界

### 已知宿主限制：没有切聊前置 hook 或请求绑定的回复提交

常规角色切换、聊天历史和新建聊天路径确实受生成锁保护：`selectCharacterById()` 仅在 `!is_send_press` 时更换角色（`public/script.js:887-905`），聊天历史入口仅在 `this_chid !== undefined && !is_send_press` 时展示（`public/script.js:11532-11537`）。但这不是完整的用户界面保护：检查点、返回主聊天和旧消息创建分支均是正常可见入口，且没有 `is_send_press` 守卫。

- `public/script.js:7685-7690`：正式 `openCharacterChat()` 先清空聊天、修改 `characters[this_chid].chat`，再调用 `getChat()`。
- `public/script.js:7594-7609, 7625-7642`：`getChat()` 已经替换全局 `chat` / `chat_metadata` 并完成渲染后，才 awaited 发出 `CHAT_CHANGED`。
- `public/script.js:5464-5479`：非流式主演出响应到达后，`saveReply()` 直接操作当时的全局聊天；这里没有原始 chat id、扩展 pre-save hook 或原聊天提交目标。
- `public/style.css:4495-4501`：带 `bookmark_link` 的消息会显示检查点旗标；`public/style.css:4569-4575` 的生成态样式只隐藏最后一条消息的动作，所以旧消息旗标仍可点。
- `public/scripts/bookmarks.js:685-714`：检查点旗标的正式点击路径可直接调用 `openCharacterChat()`，没有 `is_send_press` 守卫。
- `public/scripts/bookmarks.js:312-321, 680-683`：检查点聊天的“返回主聊天”也直接调用 `openCharacterChat()`，没有生成守卫。
- `public/scripts/bookmarks.js:729-733, 449-466`：旧消息“创建分支”会新建并打开分支聊天，同样没有生成守卫。
- `public/script.js:5548-5560`：`stopGeneration()` 是正式取消能力，但扩展最早只能在迟到的身份观察或 `CHAT_CHANGED` 后调用。

v2 记录自己拥有的 understanding/performance 请求；身份变化、流式 token 身份不符、切聊、禁用或卸载时立即 `stopGeneration()`，新聊天不接收插件 metadata，旧聊天保留 pending/understanding 恢复点。fake adapter 测试覆盖这些可观察行为。但 `CHAT_CHANGED` 本身晚于新聊天装载，非流式响应可能恰好在装载与 stop 之间进入 `saveReply()`；正式 API 无法把响应绑定回原 chat，也没有更早的扩展事件。

因此，正常单角色聊天的源码可以提交、推送和使用；生成未结束时不要通过检查点、分支或其他宿主路径切到另一聊天。v2 不能声称数学上“任何时序都绝不让可见回复串聊天”：它能停止尚可取消的本插件请求、拒绝不属于当前事务的状态提交，并保留来源聊天恢复点，却不能撤回已进入核心 `saveReply()` 的迟到非流式回复。这是明确保留的 1.18.0 宿主使用限制，不把它包装成已解决，也不把它夸大成源码发布阻断。

只有产品未来要求跨所有宿主入口的绝对回复隔离时，才需要 SillyTavern 核心提供至少一种正式能力：聊天切换前可 await/取消的事件、以 chat identity 绑定的生成/保存事务，或回复写入前可 abort 的 hook。本插件不会用 DOM、fetch、函数 monkey patch 或核心修改伪造这些能力。

### 原生检查点与分支的实际语义

- `public/scripts/bookmarks.js:171-182`：创建分支时会按所选消息截取聊天消息。
- `public/scripts/bookmarks.js:197-242, 253-297`：原生分支和检查点分别创建新聊天，并写入 `main_chat` 来源标记。
- `public/script.js:7347-7373`：新聊天保存时以 `{ ...chat_metadata, ...newMetadata }` 复制创建瞬间的当前 metadata，而不是按所选旧消息重建 metadata 历史。

因此原生消息历史可以回到较早的点，但导演 metadata 没有“按所点消息精确回溯”的正式语义。v2 的 `PerChatRepository.adoptNativeBranchClone()` 只接受同一角色、带有精确 `main_chat` 来源标记的副本：它把来源创建瞬间的**已提交**导演 `state` 和固定 `scenario` 快照重绑为新 `characterId + chatId`，来源聊天保持不变；目标聊天重建自己的 runtime cursor，绝不继承来源的 operation 或 pending transaction。若来源仍在生成或有未完成事务，接管会被拒绝。于是一个剧本可绑定多个聊天、各自独立推进，但这是 current-state clone，而非所点历史消息的精确导演状态回溯。

### 其他正式边界

SillyTavern 1.18.0 没有“完整模型回复到达但尚未首次渲染”的统一扩展钩子。流式 token 会立即进入 UI（`public/script.js:3584-3680`），因此插件不能声称会在玩家首次看到任意流式输出前完成事后语义审查。

产品据此采用信息最小化：隐藏 `generateRaw()` 决策器可以看到导演所需的内部事实；主演出模型只收到经过确定性白名单编译的本轮可演事实、必须发生内容和不含秘密原文的禁止边界。若未来要求“任意流式文本必须先完整审查再显示”，1.18.0 正式 API 无法满足，且本插件不会用 DOM、fetch 劫持或核心补丁绕过。

`saveChatConditional()` 会记录但吞掉保存异常，且没有独立的 durability acknowledgement（`public/script.js:9352-9378`）。因此能够保证成功写入时的文件原子性，并可凭已持久化 pending transaction 恢复；不能从扩展事件流证明磁盘写入已经持久化完成。
