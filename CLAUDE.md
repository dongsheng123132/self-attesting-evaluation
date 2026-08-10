# ShadowOS = Harness OS — 工作目录

> 目标：**第一台能证明「AI 学历跨会话、跨 Harness、跨模型继承」的机器**。
> 模型是 CPU（deepseek），我们造主机：本境=硬盘（学历），本象=世界状态，影核=动作，北桥=知，南桥=行。

## 学堂循环（本目录的玩法）

每个任务状态存一份 `task.origin.json`。AI 干活时：

1. **开会（SessionStart）= 北桥 boot**：注入**开机自检**——当前任务全量 + 其余学历只列目录 + 体检行。**这一刻没有 goal，所以 boot 不做任何相关性猜测**（它是确定性的，同样磁盘状态跑两次逐字节相同）。
1b. **你说话那一刻（UserPromptSubmit）= 北桥 request**：goal 出现了，北桥才按相关性把「boot 未装载、且本会话没注入过」的事实调进来；没有相关的就一条都不注入。**于是「预算装不下」不等于「这辈子看不到」。**
2. **干活中**：状态变了就顺手更新 `current_state`、`facts`、`actions`。
3. **收工（hook 自动，机制精确版）**：
   - `Stop` hook（每轮触发，非会话结束）→ 本轮消息追加到 `.claude/trace.jsonl`（trace 是学堂原料，不是状态）
   - `SessionEnd` hook（会话真正退出时触发）→ 逐份比对 `content_hash`：**内容没变一个字节都不写**；变了才 version+1
   - 状态文件本身（`current_state`/`facts`/`next_steps`）由 AI 干活时主动维护
4. **明天/换模型/换 harness**：再开会，bundle 自动重新编译，接着干。

### 改学历必须走乐观锁（本境 v0.2）
本机常态是**多个会话并发开着**，直接 Write 覆盖 `task.origin.json` 会静默吃掉别的会话刚写入的已验证事实（实测发生过）。所以：

```bash
node southbridge/benjing-put.mjs --show demo/taskN/task.origin.json          # 拿 computed_hash
node southbridge/benjing-put.mjs demo/taskN/task.origin.json --expect <hash> --from next.json
# 退出码 0=写入/无变化  3=diverged（有人改过，去合并别硬写）  4=denied（没带 expect）
```

新建用 `--create`。改之前**一定要重新读盘**，不要用会话早期读到的那份内存副本。

**这条是硬拦截，不是建议**：`PreToolUse` hook（`.claude/hooks/guard-benjing.mjs`）会直接阻断 `Write/Edit/MultiEdit` 对任何 `task.origin.json` 的写，退出码 2。实弹验证过。注意它只在 Claude Code 生效，codex 那侧目前只能靠体检事后发现。

### 本象：唯一的观察者（benxiang/0.1）
「看世界」只有一个实现。别在部件里各写各的 `sha256`/`existsSync`——那是「自证」在本仓库复发五次的结构性原因（RFC-0006 §0）。

```bash
node benxiang/observe.mjs <path>     # 看某个对象现在什么样 → state.object
node benxiang/reobserve.mjs          # 回头看一轮：学历 / 活的声明 / 历史声明，落 observations.jsonl
```

**铁律：`observe()` 永不接收「你觉得应该是什么」**——传第三个参数直接抛错。观察器一旦收预期就退化成确认偏误机。比对用 `compare(观察结果, 声明)`，必须是拿到观察之后的第二步。

`benxiang/observations.jsonl` 是「上次被独立观察是什么时候」的唯一答案来源。**只看一眼不算观察，要跟上一轮比。**

### 北桥：两个时刻（northbridge/0.2）
```bash
node .claude/hooks/load-state.mjs                                       # 看 boot 摘要
echo '{"prompt":"你的目标","session_id":"x"}' | node .claude/hooks/context-request.mjs   # 看按目标检索的结果
```
**相关性只能在知道目标之后判断。** 在 SessionStart 做筛选是猜不是筛——那是北桥 v0.1/v0.2 反复丢学历的根因（RFC-0007）。

**投影必须披露自己丢了什么**（判据组 N6）。`compileRequest` 返回 `manifest`：正文给模型看，
清单给判据看，两者同源。落选分六种，只有 `budget`/`max` 算遗漏——它们落选的原因是**容量不是
相关性**，所以披露里必须带「未装载中最高分 vs 已装载中最低分」。实测两者可以完全相等：
那时正文若只写「调入 3 条（候选 12 条）」，读的人会以为其余 9 条不够相关。
`threshold` 不算遗漏（那是判断），`scope` 只出计数不出路径（列名字本身就是泄露）。

### 学堂：经验必须能被推翻（xuetang/0.1）
`facts` 回答「这个任务发生过什么」，`learnings` 回答「下次别再这样」。后者是"上学"的产物。

盘点时的真相是：58 条经验，49 条自称 `verified`，**0 条能被任何人重跑**——作者给自己发证跑了 58 次。
所以规则跟本境的 `source` 对称：**fact 的 source 必须引可复核物；learning 的 `recheck` 必须是可重跑的命令。**

```bash
node xuetang/exam.mjs --dry-run   # 长循环考试：只跑不写
node xuetang/exam.mjs             # 跑一轮并按结果升降级（写回走乐观锁）
```
- **写经验只能写 `candidate`**：`verified` 只由考试给，手写会被压回去（判据 X2.1）。
- **recheck 要挂"这条经验被违反时会变红的那个验证器"**，不是随便找个恒绿的命令。
- **跑不起来（error）不升不降**：环境坏了 ≠ 经验错了。
- 只有 `verified` 会被北桥调进上下文；candidate 不进。

### 协议回归（改完协议顺手跑）
```bash
node benxiang/verify-benxiang.mjs        # 本象 v0.1
node northbridge/verify-northbridge.mjs  # 北桥 v0.2（boot 确定性 / request 相关性 / 可达性不变量）
node southbridge/verify-benjing.mjs      # 本境 v0.2（装载类判据已搬到北桥，B1.0 确认它们仍在跑；B11 残缺写入、B12 source 解引用）
node southbridge/verify-southbridge.mjs  # 影核 v0.2（双驱动 parity + Trust 加固 + 差分幂等 + T9 批准出处）
node oob/verify-oob.mjs                  # 带外观察 v0.1（大部分是反向用例）
node oob/crosscheck.mjs                  # 带外对账：学历声称 ↔ 影核审计、boot 自报 ↔ 磁盘实数（退出码 1 = 有分歧待解释）
node southbridge/verify-todo.mjs         # 待办传播 v0.1（大部分是反向用例）
node xuetang/verify-xuetang.mjs          # 学堂 v0.1（反向用例：作者自封 verified / 恒绿考题 / 空当全绿）
node governance/verify-governance.mjs    # 治理边界 v0.1
node governance/verify-anchor.mjs        # 证据锚定 v0.1（反向用例：隐私泄漏 / 守卫空转 / 自证时间）
node southbridge/benjing-todo.mjs list --dupes   # 查跨学历重复待办（退出码 2 = 有重复）
node southbridge/verify-state.mjs demo/taskN/task.origin.json   # 单份学历
```
> ⚠ **这里不写判据条数**。多个会话在并发加判据，任何写进本文件的数字第二天就是假的
> （2026-08-10 实测：影核注释写 43，实跑 53）。**要真数就跑一遍看 `判决 N/N`。**
> 每个套件都自报实际计数，不硬编码 —— 硬编码计数正是论文案例 9 的病。

### 证据锚定：唯一不由我们自己签发的时间（governance/anchor/0.1）
本机 git **没有 remote，commit date 可以任意伪造**，所以仓库里的任何时间主张都不可外部核验。
锚定把「此刻盘上的证据集合」压成一个指纹，交给我们控制不了的东西盖章（OpenTimestamps → 比特币区块头）。

```bash
node governance/anchor.mjs build     # 重建清单（确定性：同盘两次逐字节相同）
node governance/anchor.mjs stamp     # 冻结快照并提交指纹（只发 32 字节哈希，不发内容）
node governance/anchor.mjs upgrade   # 1~24h 后把日历承诺升级成比特币区块证明
node governance/anchor.mjs verify    # 回盘比对 + 检查外部时间锚
# 退出码 0=一致且有外部时间锚  1=用法错  3=一致但没盖章（不给绿灯）  4=与磁盘分歧
```

- **清单里没有任何时间字段**：自己给自己写时间戳就是论文批的那个病。时间只在 `.ots` 里。
- **锚点是冻结快照，不原地覆盖**：账本天天在长，改一个字节 `.ots` 就失效。
  快照存 `governance/anchors/<内容哈希>.json`，文件名只用哈希——带日期的文件名仍是自证时间。
- **排除优先于收录**：客户工作区 / 隐藏判据集 / 语料一律不锚定，且排除项只出计数不出路径（列名字本身就是泄露）。
- 改完协议或论文后重新 `stamp`；旧锚点留着别删，它们证明的是当时的状态。

### 无头 harness 落盘走南桥 CLI（影核 v0.2）
codex/Hermes 这类无头 harness 要往 `demo/` 写东西时，**别用它自己的写文件工具，走南桥**——受审计、有风险分级、有幂等、写后回读验证：

```bash
node southbridge/southbridge-cli.mjs write  --relpath demo/x.md --content-file - < body.md
node southbridge/southbridge-cli.mjs verify --relpath demo/x.md
# 退出码 0=done/replayed  2=需批准  3=拒绝  4=失败/diverged  1=用法错
```

覆盖已存在文件属 medium 风险，要先 `verify` 拿 sha256 再 `--expect-sha256 <hash>`（"证明你读过"）。
MCP 通道（`southbridge_write` 工具）在 codex 上会被它自己的工具审批闸门堵死，headless 场景一律用 CLI。

### 铁律
- **不存聊天记录，存 State + Verified Facts。** 聊天记录是"影"，本象是"对象本身"。
- **facts 必须带 verified**：没验证的话不配叫 fact，叫"假设"。
- **learning 先 candidate，验证后才 verified**：一次成功不是永久真理。
- **命名冻结**：2Origin / 本象 / **取象** / 本境 / **本器** / 影核 / 北桥 / 南桥 / 学堂 —— 一个季度内不改。
  - **取象 Quxiang · Sensor** 是本仓库那个观察器（`benxiang/observe.mjs`）的正名。「本象 / Benxiang」
    从此只指**表示层**（Origin IR，实现在 `本象协议/`）——一名两物的裁决见
    [`2origin-computer/NAMING-DECISION.md`](../2origin-computer/NAMING-DECISION.md)。
  - **代码目录 `benxiang/` 暂不改名**：35 条已验证事实的 `source` 指着它，路径别名表未就位；
    且 16 份锚点快照 + 67 份学历备份里的旧名**永远不能改**（改一个字节 `.ots` 就失效）。

## 目录
- `schemas/` — task.origin.json 等状态格式
- `.claude/hooks/` — SessionStart 加载学历 / Stop 存 trace / SessionEnd 归档
- `demo/` — 一个个跑通闭环的真实任务
- `research/` — harness 领域最佳实践蒸馏（每周二自动更新）

## 记忆
跨项目记忆在 `C:\Users\ZhuanZ\.claude\projects\D--uking---ShadowOS---Harness-OS\memory\`（战略/学堂/本境升级）。本目录的 CLAUDE.md 只放"怎么用这套系统"。
