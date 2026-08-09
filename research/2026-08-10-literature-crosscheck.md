# 外部简报核验 + 补充文献（2026-08-10）

> 起因：一份外部 AI 简报（无一条引用）断言 Harness 领域 6–8 月有十项新进展，并据此给本仓库排了六个优先级。
> 本文件是对它的**逐条回查残骸**，外加顺着内容补搜到的十篇它没提、但与本仓库部件直接对位的论文。
>
> **复核**：`node research/verify-citations.mjs --self-test` —— 22/22，且喂假条目会红（不是恒绿考题）。
> 台账：`research/citations.json`

## 0. 我核了什么，没核什么

| 核了 | 没核 |
|---|---|
| 每个 arXiv id 真实存在，标题/日期与记录一致 | 论文的实验是否站得住 |
| 抽查的数字是否**逐字出现在摘要原文**里 | 数字是否可复现 |
| `AMAP-ML/LongHorizon-Harness` 仓库存在、MIT、487 star | 那份代码是否真能跑 |
| MCP `2026-07-28` 规范目录存在于官方仓库 | 规范内容是否如简报所述 |

**边界写清楚**：「摘要里写着 64.2%」和「64.2% 是真的」是两件事。本文件只证到前一件。

## 1. 结果：简报 10/10 属实

先前判它「大概率合成」是错的。数字抽查三处，全部逐字对上。

| 简报叫法 | arXiv | 日期 | 抽查 |
|---|---|---|---|
| Ledger | [2608.00808](https://arxiv.org/abs/2608.00808) | 08-01 | 摘要原文：56.2%→64.2% (GPT-5 mini)、75.8%→81.0% (MiniMax M2.5)、成本 −28.9%/−31.8%、Codex +3.4pp @ −24.4% ✅ |
| MAGE | [2606.06090](https://arxiv.org/abs/2606.06090) | 06-04 | Grow/Compress/Maintain/Revise、+7.8~20.4pp、−55.1% token ✅ |
| LongHorizon-Harness | [2608.01964](https://arxiv.org/abs/2608.01964) | 08-03 | 51.8→80.7 / 69.7→77.2 / 2.8→8.3 / Opus 4.7 20.0→34.3 ✅ |
| StructAgent | [2607.11388](https://arxiv.org/abs/2607.11388) | 07-13 | ✅ |
| Self-GC | [2607.00692](https://arxiv.org/abs/2607.00692) | 07-01 | ✅ |
| HarnessCompass | [2608.01918](https://arxiv.org/abs/2608.01918) | 08-03 | ✅ |
| HarnessFix | [2606.06324](https://arxiv.org/abs/2606.06324) | 06-04 | ✅ |
| Living-Harness | [2607.26598](https://arxiv.org/abs/2607.26598) | 07-29 | ✅ |
| EvolveNet | [2608.04968](https://arxiv.org/abs/2608.04968) | 08-05 | ✅ |
| AOHP | [2606.23449](https://arxiv.org/abs/2606.23449) | 06-22 | ✅ |
| Commit-Time Authorization | [2607.10487](https://arxiv.org/abs/2607.10487) | 07-11 | 摘要原文：262/270 到达可见结果、55/270 是授权完成、216 行失效样本中 207 行在授权路径失效后仍提交 ✅ |

**两条一度对不上，原因是简报用了论文的绰号而非标题**：`Ledger` 的正式标题是 *Turning Interaction History into Execution State*，`MAGE` 的是 *Beyond Semantic Organization*。按名字搜不到，按内容搜一次就出来。

### 这次真正的教训

不是「没引用就是假的」。是：**一份真东西和一份编的东西，在没有引用的情况下长得一模一样，而分辨成本只有八分钟 curl。**
引用的价值不在于它证明了什么，在于它把核验成本从「重做一遍研究」降到「跑一条命令」。这跟本仓库对 `source` 和 `recheck` 的要求是同一条道理。

## 2. 简报没提、但更贴本仓库的十篇

简报按「Harness 领域大势」选文，所以选的都是长程执行与自进化。本仓库真正卡住的地方在**并发、恒绿判据、批准出处**，那几格它一篇没提。

| arXiv | 论文 | → 与本仓库哪个部件对位 |
|---|---|---|
| [2606.15376](https://arxiv.org/abs/2606.15376) | **CoAgent: Concurrency Control for Multi-Agent Systems** | **本境乐观锁的直接批评者。** 摘要原话：*OCC abort-and-retry discards minutes of work on every conflict*。这正是 `benjing-put --expect <hash>` 退出码 3 的形状——检测到分歧，然后把活扔回给人。它的解法是「控制转为建议式：runtime 通知，agent 修复」（MTPO：启动时定序、按序过滤读、就地投机写、saga 式逆操作）。**本境 v0.3 的方向不是换锁，是让退出码 3 带上「谁改了什么 / 你的哪条读被作废了」，让 agent 修那一条而不是重来。** |
| [2605.20744](https://arxiv.org/abs/2605.20744) | **Hack-Verifiable Environments** | **`probe-rogue-driver.mjs` 的方法论外部先例。** 它把 reward hacking 的机会**内嵌进环境**，使「有没有被利用」by design 可判定，而不是事后翻轨迹。跟 RFC-0009「造一个真的想违规的考生」是同一招。提示：三个叛徒驱动应当常驻判据集，不是一次性脚本。 |
| [2607.18575](https://arxiv.org/abs/2607.18575) | **RECEIPT: Reward-Hacking-Resistant Verification** | 摘要原话：*a coding agent's claims cannot be trusted on their own*。四件事：环境隔离、PoC 约束、**role separation**、**verdict binding**。verdict binding ≈ RFC-0009 还缺的 `bound_effect_hash`；role separation ≈「决策权与判断依据分离」。它的验证走 constrained replay，确定且可复现——`recheck` 该长的样子。 |
| [2607.22711](https://arxiv.org/abs/2607.22711) | **CORVUS: Context Optimization via Underlying Synchronization** | **北桥投影陈旧问题。** 它指出 append-only 轨迹把 file-read 和 observation 耦死，快照永久固化后变陈旧，agent 于是反复重读、每读一次再追加一份。解法是解耦：维护「相关文件登记表」，每轮只注入当前内容。`benxiang/observations.jsonl` 已经是这张表的雏形，但北桥 request 注入的事实目前没有陈旧判定。 |
| [2506.07564](https://arxiv.org/abs/2506.07564) | **SAFEFLOW** | 影核 + 本境事务的完整版对照：细粒度信息流控制（provenance / integrity / confidentiality 标签）、共享状态上的事务执行与冲突解决、write-ahead logging、rollback、secure cache。 |
| [2604.09744](https://arxiv.org/abs/2604.09744) | **MPAC: Multi-Principal Agent Coordination Protocol** | ⚠ **最该读的竞争者。** 它明确说 MCP 和 A2A 都假设单一 principal，多方 agent 改同一仓库时「协调塌缩成聊天、手工合并或静默覆盖」——跟本仓库的问题陈述一字不差。它已交付：21 种消息类型、三个状态机、Lamport 时钟因果水位、乐观并发控制、**Python 与 TypeScript 两个可互操作参考实现 + 223 测试 + JSON Schema 套件**。本仓库的一致性测试自己承认「两个实现出自同一作者」——MPAC 把这一步做完了。看它怎么定义「互操作」判据。 |
| [2604.06693](https://arxiv.org/abs/2604.06693) | **Aegon: Ledger-Bound Tokens + Hardware-Attested Receipts** | `governance/anchor` 的另一条路：Certificate-Transparency 式 Merkle 树罩在 append-only 账本上，第三方可独立核验「这条记录没有被追溯修改」。你用 OpenTimestamps 锚外部时间，它锚的是不可追溯篡改性。两者互补，不冲突。 |
| [2608.03699](https://arxiv.org/abs/2608.03699) | **TARL: Transaction-Aware Reliable Ledgers** | **学堂升降级可直接抄的一格。** 它批评把记忆更新压成二元 Write/Hold，拆成五个可执行动作，维护 **accepted / pending / rejected 三本账**，并明确要求「保留冲突证据」。学堂现在只有 candidate/verified + error 不升不降；**rejected 单独立账 + 留冲突证据**是缺的那一档——被考试推翻过的经验，现在是消失，不是留档。 |
| [2602.04284](https://arxiv.org/abs/2602.04284) | **Agent-Omit: Adaptive Context Omission** | 列在这里是**反例**：它把「省得聪明」做到了 RL 训练，但通篇不涉及「省了什么要不要说」。和 Self-GC 的 recoverable sidecar 并读，见 §3。 |
| [2608.03222](https://arxiv.org/abs/2608.03222) | **Fail-Fast, Restart-Smart** | 关联较弱，存档。长轨迹早停 + 同策略重启，把中断的仓库 diff 作为可选叠加层交还给新 rollout。 |

## 3. 检索没找到的三格

⚠ 措辞小心：以下是「我按这些检索式没找到」，不是「领域里不存在」。检索式记在下面，可复核可推翻。

**(1) 投影遗漏披露（omission disclosure）**
检索 `abs:"omitted" AND abs:"context" AND abs:"agent"` 命中的是 Agent-Omit（怎么省）、DebateOCR（省了还能不能恢复），最接近的是 Self-GC 的 recoverable sidecar。
**没有一篇要求投影产出一份机器可读的「丢了什么 / 为什么丢 / 去哪捞」清单，并为此写判据。**
领域在做 omission **efficiency**，没人做 omission **accountability**。仓库自己列为优先级最高的那个缺口（`projection must_disclose_truncation` 没有一致性向量），确实是空的——抄不到，只能自己定义。

**(2) 判据集自身是否恒绿**
Hack-Verifiable Environments 把可检测的作弊机会嵌进环境，但它测的是 **agent** 会不会作弊。
**没检索到测「验证器自己是不是恒绿」的工作。** `xuetang/verify-xuetang.mjs` 的 17 条反向判据、以及 RFC-0009 用叛徒驱动证伪 T6 组这件事，在文献里我没找到对应物。**这可能是本仓库最有辨识度的一格**，而且它已经有实弹战果（43/43 全绿 同时 R2/R3 越权得手）。

**(3) 谁保证 runtime 发出的信号不是假的**
这是相对 Commit-Time Authorization 的真实增量，值得单列。
CTA 摘要原话：CommitGuard 阻断陈旧提交，**`when runtimes emit witness, dependency, binding, and eligibility signals`**。
**它把「runtime 会如实发信号」当成前提。** 而 RFC-0009 的 R3 恰好就是这个前提的反例：驱动自调 `assessRisk` 看到 medium、自行降级、带 `approval:"confirm"` 过闸，审计**完整且合法**。信号是假的，监控器一切正常。
RFC-0009 §3 的「观察在核心，不在驱动；审计记观察不记声明」正好补这一格。**CTA 定义了提交边界的四个条件，没定义这些条件的证据由谁产出。**

## 4. 修订后的动作

简报给了六个优先级。核验之后我把它压到三条——理由是前两条不依赖任何一篇论文成立，第三条有现成代码。

1. **Projection Manifest 的 `dropped[]` 挂到北桥 request**，并配反向判据（投影确实丢了东西但 `dropped` 为空 → 红）。§3(1) 说明这一格抄不到，先做的人定义它。
2. **RFC-0009 补两格**：`bound_effect_hash`（借 RECEIPT 的 verdict binding）+ 新鲜度。同时把 §3(3) 那段写进 RFC 的「与外部工作的关系」——你相对 arXiv:2607.10487 的增量是可陈述的，别浪费。
3. **clone `AMAP-ML/LongHorizon-Harness`**（MIT，487 star，简介写着原生支持 Claude Code / Codex / OpenClaw）。只看一件事：**它的 read-only Auditor 凭什么不是「换了个 prompt 的同一个 Executor」**——这正是 RFC-0009 §4 承认的边界（同进程内防御不存在）。

**降级项**：简报第九节那套五层评测（H0–H4、12 个指标、9 类人造事故）暂缓。理由不变——自己出题自己发证，学堂已经踩过（58 条经验 49 条自称 verified，0 条可重跑）。真要做，先看 Hack-Verifiable Environments 怎么让作弊 by design 可判定。

## 5. 待办

- [ ] 读 MPAC（2604.09744）的互操作判据定义——它解决了本仓库一致性测试自认的「两个实现同一作者」问题
- [ ] 把 `harness-tracker.md` 第 1 期那 12 条补上 arXiv id；目前只有 3 条经本次核验（Living-Harness / EvolveNet / LongHorizon-Harness），其余 9 条状态未知
- [ ] 确认 MCP `2026-07-28` 规范内容（本次只确认了官方仓库存在该版本目录，没读正文）
