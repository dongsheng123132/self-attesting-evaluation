# AGENTS.md — ShadowOS 仓库操作规则（无头 harness 必读）

Codex / Hermes / OpenClaw 等启动时自动加载本文件。内容与 `CLAUDE.md` 同源，这里只留**动手时必须遵守的部分**。

## 1. 落盘走南桥，别用你自己的写文件工具

往 `demo/` 写东西一律经南桥 CLI —— 受审计、有风险分级、有幂等、写后回读验证：

```bash
node southbridge/southbridge-cli.mjs write  --relpath demo/x.md --content-file - < body.md
node southbridge/southbridge-cli.mjs verify --relpath demo/x.md
```

- 退出码：`0`=done/replayed　`2`=需批准　`3`=拒绝　`4`=失败/diverged　`1`=用法错
- stdout 只有一行 `action.result` JSON，直接解析
- **内容走 `--content-file` / `--stdin`，别塞进 `--content`**（Windows argv 上限 32767，长参数会挂）
- **内容来源必须显式**，漏给会判用法错（防手滑写出空文件）
- 重试请带 `--idempotency-key <k>`：同 key 同请求不会重复写
- **`--content-file` 用 `C:/...` 或仓库相对路径，别用 `/c/...`**：Node 把 `/c/tmp/x.md` 按 cwd 盘符解析成 `D:\c\tmp\x.md`（`node -e 'console.log(require("path").resolve("/c/tmp/x.md"))'` 可复现）。
  git-bash 会先替你翻译所以看不出问题，但 Hermes 这类不做翻译的 shell 会直接 ENOENT（实测踩过）

**覆盖已存在的文件是 medium 风险**，会被拒。先 `verify` 拿 `sha256`，再带 `--expect-sha256 <hash>` 重试——这叫"证明你读过"，是无头 harness 唯一拿得出的批准凭据。

MCP 工具（`southbridge_write`）在 codex 上会被它自己的工具审批闸门堵死，**headless 一律用 CLI**。

## 2. 改学历必须走乐观锁，绝不直接 Write

本机常态是多个会话并发开着。直接覆盖 `task.origin.json` 会静默吃掉别的会话刚写入的已验证事实（**实测发生过**）：

```bash
node southbridge/benjing-put.mjs --show demo/taskN/task.origin.json        # 拿 computed_hash
node southbridge/benjing-put.mjs demo/taskN/task.origin.json --expect <hash> --from next.json
# 退出码 0=写入/无变化  3=diverged（有人改过，去合并别硬写）  4=denied（没带 expect）
```

改之前**重新读盘**，别用会话早期读到的那份内存副本。新建用 `--create`。

## 3. 开工先读状态，别问用户"任务是什么"

`demo/*/task.origin.json` 是任务的唯一真相。看 `current_state`（现在到哪了）和 `next_steps`（还剩什么）。
交接信物只有状态文件，不复制聊天记录。

## 4. 铁律

- **不存聊天记录，存 State + Verified Facts。**
- **facts 必须带 `verified` 和可复核的 `source`**：没验证的话不配叫 fact，叫"假设"。
- **learning 先 `candidate`，验证后才 `verified`**：一次成功不是永久真理。
- **动作报 success ≠ 任务成功**：以写后观察（`verify` 拿到的 sha256）为准。

## 5. 改完协议顺手跑回归

```bash
node southbridge/verify-southbridge.mjs   # 影核 v0.2，36 条判据
node southbridge/verify-benjing.mjs       # 本境 v0.2，25 条判据
node southbridge/verify-state.mjs demo/taskN/task.origin.json
```
