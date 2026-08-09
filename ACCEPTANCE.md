# ShadowOS 验收报告 · 第一台

> **主张**：这是第一台能证明「AI 学历跨会话、跨 Harness、跨模型继承」的机器。
> 本文每条主张都附**不可伪造的复现命令**。看不惯结论可以自己跑，判据不采信任何 agent 的自述。

生成于 2026-08-08。协议版本：本境 `2origin/0.2`、影核 `shadowcore/0.2`。

---

## 0. 一句话

模型是可替换的 CPU；**学历存在磁盘上，不在上下文里**。换会话、换 harness、换模型，任务都能接着干。

---

## 1. 验收结论

| 主张 | 结论 | 不可伪造的证据 |
|---|---|---|
| **跨会话继承** | ✅ 通过 | 状态文件 + SessionStart 编译的学历 bundle；关窗重开靠 `task.origin.json` 续上，不重放聊天记录 |
| **跨 Harness 继承** | ✅ 通过 | Claude Code → Codex 零追问续作；Hermes 经南桥 CLI 落盘，审计日志可定通道归属 |
| **跨模型继承** | ✅ 通过 | 同一 harness 换模型零追问；两个模型报出的数字对只追加日志**逐行复算**分毫不差 |

**协议自检**：影核 43/43、本境 49/49，六份学历全绿。全部判据取自磁盘真相（`readFileSync` / `existsSync` / 行数 / 退出码），不采信工具返回的任何自述。

```bash
node southbridge/verify-southbridge.mjs      # 影核 43 条
node southbridge/verify-benjing.mjs          # 本境 49 条
node southbridge/verify-state.mjs demo/task5/task.origin.json
```

---

## 2. 跨模型继承（demo/task5）——最强的一条

### 为什么以前的测试不算数

`demo/task2` 做的是 Claude Code → Codex，**同时换了 harness 和模型**。两个变量混在一起，证不出「跨模型」。

### 这次的做法：把模型隔离成唯一变量

同一 harness（Hermes）、同一份 `task.origin.json`，只换模型。**四棒接力，跨三家厂商**：

| 棒次 | 模型 | 厂商 |
|---|---|---|
| STEP-A | `deepseek-v4-flash` | DeepSeek |
| STEP-B | `deepseek-v4-pro` | DeepSeek |
| STEP-D | `gpt-5-mini` | OpenAI |
| STEP-E | `kimi-k2.6` | Moonshot |

每一棒收到的提示词**全文不含任何任务描述**：

> 读 demo/task5/task.origin.json 和 AGENTS.md，接着干你负责的那一步。不要问我任务是什么。

每一棒都自行从状态里认出了自己该干哪一步并完成，**全程零追问**。

> 关键手段：`OPENAI_BASE_URL=https://api.u-claw.org.cn/v1` + `OPENAI_API_KEY` 覆盖 hermes 端点，
> 就能在**同一 harness 内**切换任意厂商的模型——这是把「模型」隔离成唯一变量的前提。

### 判据为什么伪造不了

任务被特意设计成：**第二棒去复算第一棒的数字**。而审计日志是只追加的，所以任何第三方都能按行切片复原当时的口径：

```bash
node -e '
const fs=require("fs");
const all=fs.readFileSync("southbridge/audit.log","utf8").trim().split("\n");
const count=ls=>{const p=ls.map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean);
  return {cli:p.filter(j=>j.actor==="southbridge_cli").length,
          mcp:p.filter(j=>j.actor==="southbridge_mcp").length};};
for (const [who,n] of [["A",1517],["B",1662],["D",2665],["E",2885]])
  console.log(who, "的口径(前"+n+"行):", JSON.stringify(count(all.slice(0,n))));'
```

实测输出，**四组全部与各模型自报的数字一致**：

```
A 的口径(前1517行): {"cli":806, "mcp":708}    ← deepseek-v4-flash 报的 806/708
B 的口径(前1662行): {"cli":893, "mcp":766}    ← deepseek-v4-pro   报的 893/766
D 的口径(前2665行): {"cli":1490,"mcp":1172}   ← gpt-5-mini        报的 1490/1172
E 的口径(前2885行): {"cli":1623,"mcp":1259}   ← kimi-k2.6         报的 1623/1259
```

产物：`channel-stats.md`（A）、`cross-model-check.md`（B）、`vendor-check-D.md`、`vendor-check-E.md`，均在 `demo/task5/`。

> **这比「产物看起来对」强一个量级。** 设计跨主体交接的验收任务，就该让后一棒去复算前一棒能被第三方复原的数字。

---

## 3. 跨 Harness 继承（demo/task2、demo/task4）

### 3.1 学籍继承

Claude Code 干 STEP-A（提炼 12 条实践 → `extracted-facts.md`），关闭；Codex 只凭 `task.origin.json` 无追问续作 STEP-B。交接信物只有状态文件，不复制聊天记录。

### 3.2 写权限——真正的瓶颈不在沙箱

一度以为瓶颈是「沙箱只读」。复测定责后**这个判断是错的**：

- codex 的 `southbridge_write` 调用**从未到达南桥进程**（南桥 `audit.log` 零记录）
- 被 codex 自己的 **MCP 工具审批闸门**掐断，`-c approval_policy=never` 不覆盖 MCP 工具
- execpolicy `~/.codex/rules/default.rules` 只有 shell 的 `prefix_rule`，`grep -ic mcp` = **0**
- 能过闸的 `--approve-for-me` / `--dangerously-bypass` 都是**全局关闸**，与分级授权主张相反

**结论：不是南桥授权模型失败，是它根本没机会生效。** 审计零记录是唯一能定责的铁证——这也是后来把审计升级成 fail-closed 前置条件的理由。

### 3.3 解法：南桥 CLI 通道（不需要任何危险 flag）

抽出 `shadowcore-core.mjs` 共享核心，加一条走 shell 的 CLI 驱动绕开 MCP 审批。**Hermes 实测打通**，且能自主通过 medium 风险闸门：

```
09:44:58  requires_approval  medium  none          ← 覆盖已存在文件，被拒
09:45:02  action.intent      medium  expect_sha256 ← 自己 verify 拿 sha256 后重试
09:45:02  action.result done medium  expect_sha256 ← 放行
```

覆盖前的备份 sha256 与覆盖前内容完全一致——**回滚真的可行**，不是形容词。

---

## 4. 这台机器为什么敢说「可验证」

四条设计约束，每条都来自实测缺陷，不是来自架构论述：

1. **动作的成败由回头观察世界决定，不由工具自述决定**
   v0.1 写完文件被外部删除，审计仍记 `status:"done"`。现在写后 `stat`+`sha256` 产出 evidence，观察不符就翻 `failed`。

2. **凡是缓存过去结论的地方，命中时都必须回头看世界一眼**
   修好 action.result 的自证后，幂等账本立刻成了新的自证来源（账本说 done，磁盘上文件已被删）。补了 `diverged` 状态。

3. **审计写不进去就不许动世界（fail-closed）**
   「所有关键 Action 必须可审计」不是口号——§3.2 的定责全靠审计零记录。

4. **学历只能经乐观锁写入**
   本机多会话并发是常态。直接覆盖 `task.origin.json` 会静默吃掉别的会话刚写入的已验证事实（实测发生过）。

5. **乐观锁之外还要防截断——这条是本次跨模型验证当场付出代价换来的**
   验证过程中 `demo/task5` 的学历**真的被吃掉过**：模型 D 读到了正确的 `content_hash`，但提交的是一份只含 1 条 fact、`current_state` 为空的**整份替换**；`expect` 完全匹配，乐观锁正常放行；E 又在残骸上继续。11 条已验证事实、2 条决策、6 条经验、3 个产物登记全部丢失。

   **乐观锁回答的是「你读的是不是最新的」，回答不了「你有没有把读到的内容带上」。** 这两件事互不覆盖。现在 `putState` 补了必填字段校验与事实缩水守卫（要删得显式声明 `__allow_fact_loss`），并在覆盖前留备份。守卫已实测：两种截断写入都被拒、磁盘未变。

   更深一层的教训：让 agent 更新共享文档时，**「读—改—整份写回」这个模式本身就危险**——它把「我这次要加什么」悄悄换成了「这份文档应该长什么样」，而模型对后者的判断很容易是残缺的。

配套的证伪机制：`facts` 的 `source` 必须引用可复核物（文件/命令/用例编号），只写自然语言断言会被验证器判 NOT VERIFIED。**这条真的抓到过本报告作者写错的 fact。**

---

## 5. 诚实的局限（没证明的部分）

- **跨模型的样本仍有限**：已覆盖 DeepSeek / OpenAI / Moonshot 三家四模型，但都是经同一网关（虾盘云）的 OpenAI 兼容接口调用，未测原生 Anthropic / Google 接口的 harness 适配。
- **task5 的 STEP-A/B 记录是事故后重建的**：原文在上述截断事故中丢失，备份机制是事故之后才加的。重建条目在状态文件里已逐条标注「非逐字原文」。四个模型的**数字本身不受影响**——它们锚在只追加的审计日志上，可独立复算。
- **codex 的 MCP 闸门未解**：harness 侧缺 per-server 授信，南桥侧已无可做。协议还缺一层——影核的 `risk`/`approval` 需要能被上游 harness 审批层理解或继承的表达。
- **观察者不完全独立**：`southbridge_verify` 与写动作同进程，严格说不算第三方观察。真正的本象验证应由外部进程做。
- **只读锁不是安全边界**：它挡的是不知情的写入者（手滑的 Write、agent 自带的补丁工具），不挡故意 `attrib -R` 的人。跟乐观锁一样是协作机制，不是权限机制。
- **本机 codex 的 Windows 沙箱 runner 是坏的**（`CreateProcessAsUserW failed: 5`），属环境故障，与协议无关，但会干扰在本机复现 §3.2。

---

## 6. 自己跑一遍

```bash
# 协议自检
node southbridge/verify-southbridge.mjs
node southbridge/verify-benjing.mjs

# 六份学历
for t in task1 task2 task3 task5 task-heartbeat uking-triage; do
  node southbridge/verify-state.mjs demo/$t/task.origin.json
done

# 跨模型的数字复算（§2）
# 见上方 node -e 片段

# 南桥写权限（任意 harness 都能用）
node southbridge/southbridge-cli.mjs write  --relpath demo/x.md --content-file - < body.md
node southbridge/southbridge-cli.mjs verify --relpath demo/x.md
```

规范：`rfcs/RFC-0004-shadowcore-v0.2.md`（影核）· `AGENTS.md`（无头 harness 操作规则）· `CLAUDE.md`（学堂循环）
