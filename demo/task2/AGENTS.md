# demo/task2 — 跨 Harness 学籍测试

这是 Codex 的引导文件（AGENTS.md，Codex 启动自动加载，作用类似 Claude Code 的 CLAUDE.md）。

## 任务
本目录是一个跨 harness 任务：Claude Code 干了一半，你（Codex）接续完成另一半。

## 开工必读（铁律）
1. **先读 `task.origin.json`**（本目录）。那是唯一的任务真相，别问用户"任务是什么"。
2. 看 `current_state`（现在到哪了）和 `next_steps`（还剩哪几步）。
3. 你只做标记为 **Codex 负责** 的步骤，不要重做 Claude 已完成的部分。
4. 干完更新 `task.origin.json`：current_state / actions / next_steps（清掉你完成的那步）。
   **但不要直接 Write 覆盖**——走仓库根 `AGENTS.md` §2 的乐观锁（`benjing-put.mjs`），
   正文落盘走 §1 的南桥 CLI（`southbridge-cli.mjs`）。直接写会吃掉并发会话的学历，实测发生过。

## 交接对象
`research/harness-tracker.md`（上游材料）· `task.origin.json`（状态）· `extracted-facts.md`（Claude 前半产物，若已生成）。
