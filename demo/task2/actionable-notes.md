# demo/task2 · actionable-notes.md — 落地清单（重建版）

> STEP-B 产物。12 条实践按「已落地 / 雏形 / 待做」分类，标注仓库内证据。
> **重建说明**：初版由主会话代 Codex 落盘，但 C5 验证器发现文件缺失；本版基于 extracted-facts.md 重建。

## 已落地 ✅

| # | 实践 | 落地证据 |
|---|---|---|
| 1 | Lilian Weng：File System=Persistent Memory | `.claude/hooks/` + `task.origin.json`，状态文件即持久内存 |
| 7 | LongHorizon：Task State + Verified Facts，不是聊天记录 | `task.origin.json` facts 必须 verified，不存 transcript（本象铁律落地） |
| 5 | Living-Harness：失败→经验→下次避免 | `learnings[]` + Stop hook 每轮 trace 进 trace.jsonl |

## 雏形 / 部分落地 🚧

| # | 实践 | 现状 | 缺口 |
|---|---|---|---|
| 3 | Harness-R1：读失败→产出 patch | 手工闭环 | 未自动化读 failure→出 patch |
| 4 | MemoHarness：Experience Bank | 学堂概念 + cron 跟踪 | 无「按任务类型调上次 state」检索 |
| 6 | EvolveNet：跨 Agent 交换 Harness 改进 | task2 证明学历继承 | 写权限未打通（南桥） |
| 8 | OneDayAgent：跨模型同一 Harness | 本机双模型路由 | 未严格复测换模型 |

## 待做 ⏳

| # | 实践 | 要做什么 | 归属 |
|---|---|---|---|
| 2 | LoopsBench：长循环考试 | ShadowWork Benchmark | 学堂/基准层 |
| 9 | HarnessOpt-Bench | AI 优化大师 | Shadow Evolve |
| 10 | Skill-Use | 影核 Action 路由/权限 | 影核 |
| 11 | Harness 成本量化 | 记录 token/耗时 | 学堂测量 |
| 12 | 小模型 adaptation | 换小模型试 | 组装机测试 |

## 本次发现

**核心**：跨 harness 学历继承=已验证（Codex 零追问续作）。**C5 验证器抓出**：actionable-notes.md 曾只被声明未落盘，已重建——架构的自验证机制起作用了。
