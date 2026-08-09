# Harness 研究跟踪 — ShadowOS 全球最佳实践蒸馏

> 每周二 9:17 自动更新（cron c2836522）。目的：把全球 Harness 领域最新实践，蒸馏成一句「能接入我们主板」的结论。
> 格式：日期 | 来源 | 一句话可操作结论 | → 应做

## 2026-08-08（第 1 期 · 人工整理）

| 来源 | 一句话结论 | → 应做 |
|---|---|---|
| Lilian Weng《Harness Engineering for Self-Improvement》(2026-07-04) | 模型≈CPU，Harness≈运行时/OS；三个稳定模式：Workflow Automation、File System=Persistent Memory、Sub-agent+Backend Jobs | 与我们的主板图完全对上：文件系统就是本境硬盘，sub-agent=进程管理。OS 层定位确认。 |
| LoopsBench《From Harness Engineering to Loop Engineering》(7/31) | 评测从「单任务成败」转向「连续几小时/几轮是否越干越不乱」；Plan→Code→Test→State→Next task | 学堂的「考试」必须测长时间循环稳定性，不是单点。 |
| Harness-R1 (8/3) | 专门训练 Harness Engineer 模型读 failure trajectory → 直接产出可执行 Harness Patch，在线 RL 训练 | 我们的 Shadow Evolve 可先不做 RL，用「失败→本境沉淀→下次加载」手工闭环替代。 |
| MemoHarness (7月) | Harness 按任务动态组装：Context/Tool/Generation/Orchestration/Memory/Output 六维 + Experience Bank | 学堂可以做成 Experience Bank：按任务类型调上次同类任务的 state。 |
| Living-Harness (7/29) | 任务结束经验不结束：失败→procedural repair→下次自动避免 | 这正是「AI 肌肉记忆」=上学循环。 |
| EvolveNet (8/5) | 不同 Agent 交换 Harness 改进（不交换数据），Federated Learning for Harness | 开源协议版图：本象协议可作为「经验交换」的共享格式。 |
| LongHorizon-Harness (8/3) | 长期核心从 Context 转 State：Manager→Execute→Audit 每轮 fresh context，真正持久的是 Task State + Verified Facts + Artifacts | **最重要**：我们 task.origin 里必须存 Verified Facts（验证过的事实），不是聊天记录。 |
| OneDayAgent (8/4) | Task decomposition + Execution memory + Final verification，跨 5 模型保持同一 Harness | Harness 是可跨模型的 Runtime 层——验证我们的组装机路线。 |
| HarnessOpt-Bench (8/6) | 榜单从 Model 变 Model×Harness：哪个模型最会优化 Harness | ShadowWork Benchmark 的定位就是测这个。 |
| Skill-Use Benchmark (8/5) | 最强 Skill-Use 分数仅 0.613；换 Harness 会改变模型排名 | 影核 Action 层必须解决「何时调 Skill、找对、不越权」。 |
| Harness 成本研究 (7/8) | 只换 orchestration layer：Token -38%、成本 -41%、时间 -44% | 学堂/本境的收益要能量化成 token 和耗时。 |
| 小模型 Harness adaptation (7/9) | 自动 Harness adaptation 后小模型达大模型 89.7% 性能、4% 成本 | 上学提升 performance 的铁证——但改不了 capability 上限。 |

**结论（第 1 期）**：领域共识已从「压缩 Context」转向「把 Conversation 转成 State」。本象协议 + 本境协议定位在 State Layer 是**主线上**。接下来盯 EvolveNet 的共享 Harness 格式与 LongHorizon 的 Verified Facts 细节。
