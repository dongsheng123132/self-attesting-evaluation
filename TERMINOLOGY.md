# 术语表 · Terminology map (中文 → English)

内部中文名**冻结不动**（一个季度内不改，见 CLAUDE.md）。这份表只解决一件事：
**英文读者、论文审稿人和公开仓库的读者，遇到这些部件时该叫它什么。**
命名冻结管的是内部一致性，对外映射是另一件事，两者不冲突。

规矩：**按代码里实际存在的东西定名，不按架构文档定名。** 文档会自相矛盾（下面有例），代码不会。

> ⚠ **跨仓库命名以 [`2origin-computer/NAMING-DECISION.md`](../2origin-computer/NAMING-DECISION.md) 为准。**
> 本表曾把「本象」定义成 the observer，而 `本象协议` 与 `2origin-computer` 的架构表把同一个词
> 定义成表示层（Origin IR）——**一名两物，两边的术语表互相矛盾**。裁决：本象归表示层，
> 本仓库的观察器改称**取象 / Sensor**。代码目录 `benxiang/` 暂不改名，前置条件见裁决 §3。

---

## 主表

| 中文 | English | 它到底是什么 | 代码在哪 | 规范 |
|---|---|---|---|---|
| 2Origin | 2Origin | 整套架构的名字。模型是 CPU，这套东西是主板 | — | — |
| 学籍 | **State Layer** | 学历的登记与版本管理：乐观锁、可复核 source、actor 溯源、残缺写入拦截。**层是学籍，实例是学历**——正如学堂产经验、学籍存学历。**代码前缀仍是 `benjing-`**（58 处 `facts[].source` 指着它，走路径别名表） | `southbridge/benjing-*.mjs` | `benjing/0.2` |
| 本境 | **Machine Profile** | 这台机器有什么、能跑什么：工具 / 版本 / 代理。**不在本仓库**——实现在 `本境协议/`(uenv)。v0.1 曾把这个词派给学历层，已推翻 | — | `uenv` |
| 学历 | **task state**（文件）/ *academic record*（比喻） | 一个任务的 `task.origin.json`：状态 + 已验证事实 + 决策 + 下一步。**不是聊天记录** | `demo/*/task.origin.json` | `2origin/0.2` |
| 取象 | **Sensor** | 「看世界」的唯一实现。铁律：`observe()` 永不接收预期——观察器一旦收预期就退化成确认偏误机。**代码目录仍叫 `benxiang/`**：改名的前置条件（路径别名表）未就位，见裁决 §3 | `benxiang/observe.mjs` | `benxiang/0.1` |
| 本象 | **Origin IR** | 世界的持久表示层：对象/关系/载荷/状态/约束/来源/边界。**不在本仓库**——实现在 `本象协议/compiler/` | — | `benxiang/origin-ir` |
| 北桥 | **context compiler** | 把状态编译进上下文窗口。两个时刻：boot（无 goal，确定性）与 request（goal 出现后才做相关性） | `northbridge/compile.mjs` | `northbridge/0.2` |
| 学堂 | **the school** / *learning loop* | 经验的产生、升降级与装载。核心规则：learning 的 `recheck` 必须是可重跑的动作——没有它，这条经验永远无法被推翻，也就永远不该叫 verified | `xuetang/learning-core.mjs`、`exam.mjs` | `xuetang/0.1` |
| 经验 | **learning** | 「下次别再这样」。与 fact（「这个任务发生过什么」）分属两类：fact 要 `source` 引可复核物，learning 要 `recheck` 是可重跑命令 | `demo/*/task.origin.json` 的 `learnings[]` | `xuetang/0.1` |
| 长循环考试 | **the exam** | 把每条 verified 经验的 `recheck` 再跑一遍，跑挂当场降级。「一次成功不是永久真理」的机械化 | `xuetang/exam.mjs` | `xuetang/0.1` |
| 南桥 | **action channel** | 把动作请求送到影核的**通道**。目前两条：CLI（给无头 harness）与 MCP。两条通道判决一致是**验证出来的**，不是假设 | `southbridge/southbridge-cli.mjs`、`southbridge-mcp.mjs` | `shadowcore/0.2` §双驱动 parity |
| 影核 | **Action Kernel** | 动作的**核**：风险判级、批准模型、审计落盘、幂等、写后回读观察。**英文不用 `ActionParity`**——parity 指「CLI/MCP 双通道判决一致」，那是我们测过它的一个性质，不是它是什么；用验证属性当名字等于用「我们测过它」当名字。ActionParity 仅作为商标保留 | `southbridge/shadowcore-core.mjs` | `shadowcore/0.2` |
| 带外观察 | **out-of-band check** | 不通过被观察者自己的自述去核对它。学历声称 ↔ 影核审计 ↔ 磁盘实数 | `oob/` | `oob/0.1` |
| 学堂循环 | **the loop** | 任务 → 经验 → 已验证状态 → 下次接着干。跨会话、跨 harness、跨模型。**这是整体，不是部件**——部件是上面那个「学堂」 | 整体 | — |
| 已验证事实 | **verified fact** | 带 `verified` 与可复核 `source` 的断言。没验证的不配叫 fact，叫假设 | — | — |
| 判据 | **conformance judgment** | 会跑的一条判据。反向判据（故意造假必须被抓住）比正向的值钱 | `verify-*.mjs` | — |

## 两处必须先解决的重叠

### 1. 影核 vs 南桥：核 vs 通道

架构文档 `ChatGPT-AI原生计算机架构 (3).md` **自己就是矛盾的**：第四章标题写「影核：南桥 + 驱动层」（影核 ⊃ 南桥），
而 §「南桥：Intelligence → World」正文写「南桥找到影核：PowerPoint Driver」（影核 = 驱动，被南桥调用）。
两种读法互斥，靠文档定不下来。

**按代码定**：`shadowcore-core.mjs` 里是 `assessRisk` / `checkApproval` / `doWrite` / `doVerify` + 审计 + 幂等——
这是**决定与执行**。`southbridge-cli.mjs` 与 `southbridge-mcp.mjs` 是同一个核的两个**入口**，
而 `verify-southbridge.mjs` 花大力气验的正是「两条通道判决一致」。

> **影核 = action kernel（决定与执行，一份实现）**
> **南桥 = action channel（怎么把请求送进来，可以有多条，parity 必须被验证）**

一句话记法：**影核决定与动手，南桥只负责把话带到。**

### 2. credential 这个英译已经被占用了

公开仓库 README 现在用 "persists credentials" 指学历，而 Trust Lane 的 `trust.credential` / `proof_of_read`
指的是**授权凭证**——同一个英文词在同一个仓库里指两样东西，审稿人第一眼就会读错。

> **裁决：`credential` 只留给 `trust.credential`（授权）。学历的技术术语是 `task state`。**
> 比喻场合可以写 "the machine's academic record"，但接口、表头、判据名一律用 `task state`。

（我在 README 的 benchmark 段落里已经写的是 "9 real task states"，与本裁决一致，不用改。
需要改的是 README 开头那句 "persists credentials"——见下方待办。）

### 3. 「影」这个字在体系里承担了两个相反的价值判断

`CLAUDE.md` 铁律第一条：**「聊天记录是『影』，本象是『对象本身』」**——这里「影」＝派生的、
次等的、不可信的那一面。而**影核**是全体系最可信的部件之一（动作的判决者：风险判级、审计、
写后回读）。同一个字，两个相反的价值。

「影核」的本意是「动作的成败由回头观察决定，**影**是自述、**核**是判决」——解释得通，
但需要解释。而需要解释的名字，在一个以「让下一个人少困惑三秒」为标准的体系里就是成本。

**标价后决定不改**（实测计数）：

| 位置 | 处数 |
|---|---|
| 代码 import / 路径 | 19 |
| 文档 / RFC | 161 |
| 学历 `facts[].source` | 20 |
| **spec id `shadowcore/0.2`** | **30** |

最后一行足以否掉它：**spec id 是协议标识符，改它等于协议版本变更**，会波及所有声称
「符合 shadowcore/0.2」的实现与记录。曾考虑过 `行核`（与「北桥知、南桥行」咬合，且摆脱
「影＝不可信」的冲突），代价不值。

**记在这里，是为了让读者知道这个冲突存在，而不是假装名字都是自洽的。**

## 已知的名实不符（记录，暂不改）

`southbridge/` 这个目录现在装了三样东西：

- **本境**（状态层）：`benjing-core.mjs`、`benjing-put.mjs`、`benjing-todo.mjs`、`verify-benjing.mjs`、`verify-state.mjs`、`verify-todo.mjs`
- **影核**（动作核）：`shadowcore-core.mjs`、`verify-southbridge.mjs`
- **南桥**（通道）：`southbridge-cli.mjs`、`southbridge-mcp.mjs`

也就是说，**「硬盘」住在「动作总线」的目录里**。这是历史堆积，不是设计。

**暂不重命名目录**，理由是代价具体而收益是审美的：9 份学历的 `source` 字段里写着大量 `southbridge/xxx.mjs` 路径，
改目录会让它们全部悬空。有意思的是——**这件事现在能被机器发现了**：`dereferenceSource` 会把这些路径报成 source 悬空
（判据 B12.2）。在有这个探针之前，重命名会是一次静默的证据链断裂；现在它至少会叫。

真要改的时候，顺序是：先跑 `node southbridge/verify-benjing.mjs` 拿基线 → 改目录 → 看 B12 报出哪些悬空 → 逐条改 source → 复跑至全绿。

## 给译者/写论文的人的几条

- **不要**把「学历」译成 diploma / degree。它不是学位，是一份可继承的任务状态。
- **不要**把「取象」译成 world model，也不要译成 `Observer`（撞 GoF 观察者模式＝事件订阅）或
  `Watcher`（暗示持续监听，它是一次性调用）。它不建模，它只观察——`observe()` 收到预期参数会直接抛错。
  英文一律用 **Sensor**：传感器不会因为你希望是 25 度就读出 25 度，那正是这条铁律本身。
- **「本象 / Benxiang」在论文里一律指 Origin IR（表示层）**，不指本仓库的观察器。二者曾长期共用
  一个名字，裁决见 [`2origin-computer/NAMING-DECISION.md`](../2origin-computer/NAMING-DECISION.md)。
- **不要**把「trace」和「学历」混为一谈。trace 是聊天记录（影），学历是对象本身。本仓库的主张恰恰是二者不可互换，
  而且这条已经测过：结构化状态 97.5%，同预算最强对话流对照 60.0%，Wilson 区间不重叠。
- 「判据」译 conformance judgment，不译 test。test 暗示「跑通即可」，判据要求「能抓住故意造的假」。

## 待办

- [ ] 改公开仓库 README 开头的 "persists credentials" → "persists task state"（与本表 §2 裁决一致）
- [ ] 本表定稿后同步一份到 `2origin-harness`，公开仓库的英文读者是主要受众
- [ ] `southbridge/` 目录名实不符：记录在案，等有一次非做不可的改动时顺手做，别为它单开一次重构

---

## 名字的债（哪些名字现在是**假的**）

对外映射解决"该叫它什么"，但有一类问题映射解决不了：**目录名声称的内容与实际内容不符**。
这不是翻译问题，是「声明冒充事实」在文件系统层的形态，与"没人加载的 schema"同型。

| 位置 | 声称 | 实际 | 状态 |
|---|---|---|---|
| `southbridge/` | 南桥 = action channel，两条通道（CLI / MCP） | 13 个 `.mjs` 分属三个协议：本境 7 个、影核 5 个、无归属 1 个。**只有 2 个真的是南桥** | 已量化，**未修** |

爆炸半径实测 258 处，其中 **108 处在学历的 `facts[].source` 里**——那是证据指针，
批量替换等于把「可复核」降级成「看起来像可复核」。迁移顺序与前置条件见
[`NAMING-REVIEW.md`](./NAMING-REVIEW.md) §2。

**在别名表就位之前不要动它。** 记在这里是为了让读者知道这条债存在，而不是假装名字都是真的。
