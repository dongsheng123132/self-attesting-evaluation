# demo/task2 · extracted-facts.md — Claude Code 前半产物

> 从 `research/harness-tracker.md`（第 1 期）提炼的 12 条结构化事实。每条含：来源论文 / 一句话结论 / 是否已验证 / 对我们主板的落点。

| # | 来源 | 事实（claim） | verified | 主板落点 |
|---|---|---|---|---|
| 1 | Lilian Weng, Harness Engineering (7/04) | 模型≈CPU，Harness≈运行时/OS；三个稳定模式：Workflow Automation、File System=Persistent Memory、Sub-agent+Backend Jobs | true | 文件系统=本境硬盘，sub-agent=进程管理；OS 定位确认 |
| 2 | LoopsBench (7/31) | 评测从「单任务成败」转向「连续多轮是否越干越不乱」，Plan→Code→Test→State→Next task | true | 学堂的「考试」要测长循环稳定性 |
| 3 | Harness-R1 (8/3) | 训练 Harness Engineer 模型读 failure trajectory → 产出可执行 Harness Patch，在线 RL | false（我们不做 RL） | Shadow Evolve 用「失败→本境沉淀→下次加载」手工闭环替代 |
| 4 | MemoHarness (7月) | Harness 按任务动态组装：Context/Tool/Generation/Orchestration/Memory/Output 六维 + Experience Bank | true | 学堂做 Experience Bank：按任务类型调上次同类 state |
| 5 | Living-Harness (7/29) | 任务结束经验不结束：失败→procedural repair→下次自动避免 | true | 「AI 肌肉记忆」=上学循环 |
| 6 | EvolveNet (8/5) | 不同 Agent 交换 Harness 改进（不交换数据），Federated Learning for Harness | true | 本象协议作为「经验交换」共享格式 |
| 7 | LongHorizon-Harness (8/3) | 长期核心从 Context 转 State：持久的是 Task State + Verified Facts + Artifacts，不是聊天记录 | true | **task.origin 必须存 Verified Facts** |
| 8 | OneDayAgent (8/4) | Task decomposition + Execution memory + Final verification，跨 5 模型保持同一 Harness | true | Harness 可跨模型的 Runtime 层，验证组装机路线 |
| 9 | HarnessOpt-Bench (8/6) | 榜单从 Model 变 Model×Harness：测哪个模型最会优化 Harness | true | ShadowWork Benchmark 测这个 |
| 10 | Skill-Use Benchmark (8/5) | 最强 Skill-Use 分数仅 0.613；换 Harness 会改变模型排名 | true | 影核 Action 层解决「何时调/找对/不越权」 |
| 11 | Harness 成本研究 (7/8) | 只换 orchestration layer：Token -38%、成本 -41%、时间 -44% | true | 学堂/本境收益要量化成 token 和耗时 |
| 12 | 小模型 Harness adaptation (7/9) | 自动 Harness adaptation 后小模型达大模型 89.7% 性能、4% 成本 | true | 上学提升 performance，但改不了 capability 上限 |

**产物元数据**
- 执行者：Claude Code（STEP-A，主会话执行）
- 来源：research/harness-tracker.md
- 时间：2026-08-08
