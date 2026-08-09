# RFC-0009 — 批准的出处（approval provenance）

> 修订 RFC-0004 §5「风险与批准」。影核 SPEC 保持 `shadowcore/0.2`（理由见 §7）。
> 状态：已实现　实测日期：2026-08-10
> 复现：`node southbridge/probe-rogue-driver.mjs`

## 0. 这条 RFC 的来历

不是设计推演，是一次证伪实验的残骸。

RFC-0004 §5 抽出「一核多影」时，在 `shadowcore-core.mjs:5` 立了一句规矩：

> 驱动只负责传输与呈现，**不得自己判风险、不得自己决定 status**。

`verify-southbridge.mjs` 的 T6 组声称在验证它，手法是「MCP 通道的判决 === CLI 通道的判决」。

**T6 验证不了那句话。** 两个驱动都 `import { doWrite }` 然后原样转发参数，判决相同是 import 语句的后果，不是任何机制的后果。无论核心怎么写、无论那句规矩是否被遵守，T6 都会绿。

**它是恒绿考题。** `xuetang/verify-xuetang.mjs` 有 17 条反向判据专门抓这个形状——抓到的第一例在影核自己身上。

恒绿考题只能用「造一个真的想违规的考生」来证伪。

## 1. 实测：三个叛徒驱动，2/3 得手

`southbridge/probe-rogue-driver.mjs`，沙箱内跑，2026-08-10：

| | 违规姿势 | 世界被改 | 审计 | 现有机制发现 |
|---|---|---|---|---|
| R1 | 核心判 `requires_approval`，驱动对下游宣称 `done` | 否 | 有反证（同 `action_id` 记着真判决） | **理论上能，实际无人对账** |
| R2 | 完全不调核心，`node:fs` 直接写盘 + 伪造 `action.result` | **是**（且在白名单外） | **零记录** | 否 |
| R3 | 自调 `assessRisk` 看到 medium，自行降级，带 `approval:"confirm"` 过闸 | **是** | **完整且合法** | 否 |

同一时刻 `node southbridge/verify-southbridge.mjs` → **43/43 ✅ VERIFIED，退出码 0**。

全绿与越权得手同时成立。这就是恒绿考题的定义。

## 2. R3 是真正的洞：两种凭据的可伪造性不对称

`checkApproval` 接受两种批准凭据，一视同仁。但它们的性质根本不同：

**`expect_sha256` 是自证的。** 核心拿它跟 `before.sha256` 一比就知真假。驱动想伪造，就必须真去读文件——**而真读了就真满足了「证明你读过」**。伪造的成本等于老实做的成本，所以它不可伪造。这是 RFC-0004 §5 做对的地方。

**`approval:"confirm"` 没有出处。** 核心无法区分「人点了确认」和「驱动打了这五个字母」。

后果不是写错了一个文件。是**事后定责会定到人头上**：审计白纸黑字写着 `approval:"confirm"`，语义是「人在环显式确认」。而 RFC-0004 §6.6 里，审计**唯一一次真正救过场**靠的就是定责能力（MCP 闸门那次，是审计零记录定的责）。

`actor` 字段能回答「这次写从哪条通道进来」，回答不了「这个批准是谁给的」。

### 2.1 真实威胁不是恶意，是阻力最小路径

需要说清威胁模型，否则会把修复做歪。

叛徒驱动不是假想的攻击者。真实场景是：一个无头 agent（codex / Hermes / Claude）撞上 `requires_approval`，与其回头找人，不如加上 `--approval confirm`——**因为 CLI 的 usage 正是这么写的**。这不是恶意，是文档指引的阻力最小路径，几乎必然发生。

所以修复的目标不是「防住恶意驱动」（§4 说明那不可能），而是**让审计能区分「人批的」和「自动化自己批的」**。

## 3. 修复：核心自己观察上下文，审计记观察而非声明

`approval:"confirm"` 现在需要一个**无头通道拿不到的东西**：

```js
export function observeApprovalContext() {
  return {
    tty: !!process.stdin.isTTY,
    headless_override: process.env.SHADOWCORE_HEADLESS_CONFIRM === '1'
  };
}
```

判定改为：

| 上下文 | 结果 | 审计记录 |
|---|---|---|
| stdin 是 TTY（真人在终端） | 放行 | `approval_evidence.source = "interactive_tty"` |
| `SHADOWCORE_HEADLESS_CONFIRM=1` | 放行 | `approval_evidence.source = "headless_override"` + `human: false` |
| 都没有 | **`requires_approval`**，世界不动 | 同上，记下被拒的上下文 |

三条设计要点：

1. **观察在核心，不在驱动。** 若把 TTY 检查放进 CLI，叛徒驱动跳过它即可——那是把 R3 原样复现一遍。核心与驱动同进程，所以核心可以直接观察。
2. **不是禁止，是定责。** 逃生门保留：自动化确实需要时设 `SHADOWCORE_HEADLESS_CONFIRM=1`，照样放行——但审计从此写着 `human: false`。R3 的伤害是「审计分不清两种情况」，修的就是这个。堵死逃生门只会让人去改代码，那更查不到。
3. **`approval_evidence` 记的是观察结果，不是调用方的声明。** 驱动传什么都不影响这个字段。

## 4. R2 不可修，只能承认边界

任何能 `import node:fs` 的驱动都能绕过核心。同进程内的防御不存在——叛徒驱动连 `process.stdin.isTTY` 都能 monkey-patch。

所以必须把话说准：

> **影核的保证边界是「经由影核的写」，不是「`demo/` 下的所有写」。**

这句话此前不在任何文档里，读代码的人会默认成后者。现在写进 §4。

R2 的方向是**检测而非阻止**，而这件事 `oob/crosscheck.mjs` 已经在做了——本 RFC 初稿说它「缺 artifact ↔ 审计对账」，核实后是错的。`reconcileArtifacts()` 正是干这个，`bypassed` 桶的措辞就是 R2 的形状：

> 这条产物没有经过风险判级、没有备份、审计里查不到是谁写的

2026-08-10 实跑：47 处待解释分歧，退出码 1。机制在，且已经在响。

**真正的缺口在枚举的起点**：`reconcileArtifacts(claims, audit, statAt)` 遍历的是 `claims`——学历声称过的产物。没有任何学历提过的那次写，从来不会进入循环。R2 探针写的 `rogue.txt` 正是这种：**不是对账判它无罪，是它压根没被点到名。**

所以 oob v0.2 要改的不是加一个对账器，是把枚举起点从「学历声称」换成「磁盘实际」——**从声称出发只能查到声称过的东西，这是「自证」在观察面上的同一个形状**（RFC-0006 §0）。

## 5. R1 缺一次对账

`action_id` 是现成的钩子：驱动 stdout 里的 `action_id` 应当在 audit.log 里存在，且 `status` 一致。

现有对账覆盖不到这一对，且原因跟 §4 是同一个：`crosscheck.mjs` 从学历声称出发，而驱动 stdout 从不进学历。留给 oob v0.2。

**结论是怀疑不是判决**（bugscope §5）：stdout 与审计不符的良性解释是——审计 append 失败但结果已返回（`result.audit === 'result-log-failed'` 正是为此存在）。对账须先排除它。

## 6. 反向判据

新增 T9 组，**全部是反向用例**（断言「违规得手不了」，而非「守规矩的两个驱动彼此像」）：

- T9.1 无头通道 `approval:"confirm"` 被判 `requires_approval`
- T9.2 被拒时世界未被改动
- T9.3 `SHADOWCORE_HEADLESS_CONFIRM=1` 放行，但审计记 `source=headless_override` 且 `human=false`
- T9.4 `expect_sha256` 路径标记为自证（`self_proving=true`）
- T9.5 `approval_evidence` 由核心观察产出，驱动伪造该字段无效
- T9.6 探针 R3 不再得手（跑 `probe-rogue-driver.mjs --json` 断言）

修订既有判据：**T4.2 反转**。它原本断言「无头 MCP 通道带 `confirm` → done」，那正是 R3 的行为，现在必须断言被拒。

## 7. 为什么 SPEC 不动

行为变了（无头 `confirm` 从放行变拒绝），按理该升版。但 `SPEC` 字符串被 `schemas/action.result.json` 的 `const`、幂等账本历史记录、oob 对账三处引用，升版会产生与本 RFC 无关的连锁改动，而 CLAUDE.md 定了命名冻结。

`approval_evidence` 是新增可选字段，向后兼容。**行为收紧记在本 RFC，不记在版本号里**——代价是：光看 `spec` 字段无法区分改前改后的核心。这是已知缺陷，v0.3 统一处理版本表达时一并解决。

## 8. 与 v0.3 主命题的关系

RFC-0004 §6.6 结尾留了一句未解：

> 协议层面仍缺一层：影核的 `risk`/`approval` 需要一种能被上游 harness 审批层理解或继承的表达 —— v0.3 的主命题。

本 RFC 是那层的前置条件。**在批准有出处之前，谈「让上游 harness 继承批准」是危险的**——继承一个无法追溯来源的批准，等于把 R3 沿着调用链传播出去。
