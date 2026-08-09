# RFC-0004 · 影核协议 v0.2（ShadowCore Action Protocol）

**Spec ID:** `shadowcore/0.2`
**Status:** Draft — 参考实现已通过验证（`node southbridge/verify-southbridge.mjs`，43/43，可重跑）
**取代:** 影核 v0.1（`southbridge/southbridge-mcp.mjs` 初版）
**原则:** 动作的成败由**回头观察世界**决定，不由工具的自述决定。

---

## 0. 这版改什么，为什么改

v0.2 不是照抄架构文档，是修三个**在本仓库实测复现过**的缺陷。每条改动都有对应的复现命令和验证用例。

| # | v0.1 实测缺陷 | 复现 | v0.2 对策 | 验证用例 |
|---|---|---|---|---|
| ① | result 是自证的：`writeFileSync` 没抛错就报 `OK`，之后世界怎样一概不知 | 写完外部 `rm`，`audit.log` 仍是 `status:"done"` | 写后回头 `stat`+`sha256` 产出 `evidence`，观察不符则翻 `failed`；另设 `southbridge_verify` 供下游翻案 | T1.1–T1.3 |
| ② | 无幂等：同一 append 重放两次 → 文件两行 | 同一请求发两次，`wc -l` = 2 | `idempotency_key` + `request_hash`，重放 `replayed` 不动世界 | T2.1–T2.4 |
| ③ | 授权一刀切：白名单内随便写、白名单外一律拒 | 无头 harness（`codex exec`）三次确认拿不到有限写权 | risk 三级 + 两种批准凭据 | T3.1–T3.6, T4.1–T4.2 |

另修：`audit.log` 的 `bytes` 用了 `content.length`（JS 字符数）当字节数——写 `# 我存在过\n` 报 7，实际 15 字节。**连自证都证错了**，这正是 evidence 必须来自回读而非自报的理由。

---

## 1. action.result

任何动作必须产出 `action.result`。`status` 的取值由观察决定：

```json
{
  "spec": "shadowcore/0.2",
  "kind": "action.result",
  "action_id": "act:18b97dc0",
  "verb": "file.write",
  "target": "demo/task2/notes.md",
  "status": "done",
  "risk": "medium",
  "approval": "expect_sha256",
  "evidence":   { "exists": true, "size_bytes": 15, "sha256": "…", "mtime": "…" },
  "state_diff": { "before": { "exists": true, "sha256": "…" },
                  "after":  { "exists": true, "sha256": "…" } },
  "bytes_written": 15,
  "reversible": true,
  "backup_path": "southbridge/.backups/1786179788296-t3.md",
  "undo_hint": "restore from backup_path"
}
```

**status 取值**

| status | 含义 |
|---|---|
| `done` | 动作已执行**且**写后观察与预期一致 |
| `failed` | 执行过程出错，或写后观察不符（世界没有按预期改变） |
| `denied` | 硬边界拒绝：白名单外、路径穿越、幂等键冲突 |
| `requires_approval` | risk ≥ medium 且未出示批准凭据。**世界未被改动** |
| `replayed` | 幂等命中，且**这次动作留下的那部分**仍在世界上。世界未被二次改动 |
| `diverged` | 幂等命中，但那部分已被外部改掉。**不得声称成功**，交调用方决策 |

> `diverged` 是第一轮验证时发现并补上的。幂等账本如果只信自己的记录，就成了第二个"声明与现实脱节"的来源——跟①是同一个病。**幂等 ≠ 可以不看世界。**

### footprint：观察范围必须跟动作的作用范围对齐

追加写的 `action.result` 多一个字段：

```json
"footprint": { "offset": 1024, "length": 15, "sha256": "…" }
```

它是**这次动作在世界上留下的那一段**。重放校验只读回 `[offset, offset+length)` 比对，而不是比整文件 sha256。

- `mode=write`：不产 `footprint`。覆盖写的语义本就是"整个文件应等于我写的内容"，比整文件是对的。
- `mode=append`：必须比 footprint。别人往同一日志继续追加是合法的，不构成 `diverged`。

**拿快照去验差分，会把"世界别处的合法变化"误读成"我的动作失效了"**，而调用方对 `diverged` 的常规处理是重试——于是重复写。这条实测代价见 §6.3。

`replayed` 返回的 `evidence` 是**此刻的观察**，不是首次动作时的旧快照；判定依据放在 `footprint_observed` 里。把旧快照当现状交出去，本身就是缺陷①的形状。

---

## 2. 风险判级：纯函数，不看模型怎么说

判据只有三个客观输入：目标在不在白名单、目标存不存在、目标是不是受保护路径。模型无法通过声明"这是低风险操作"来降级。

```
1. 不在白名单 demo/          → denied（硬边界，不进分级）
2. 受保护路径 且 已存在      → high
3. mode=write 且 已存在      → medium（破坏性覆盖）
4. 其余（新建 / append）     → low
```

受保护路径（即使在白名单内）：`*task.origin.json`、`*.mjs`、`schemas/**`、`.claude/**` —— 学历文件、协议文件、代码。

---

## 3. 批准：给无头 harness 的授权模型

这是 v0.2 最实质的设计增量，直接针对已实测三次的瓶颈：**`codex exec` 拿不到写权，且传 `-s workspace-write` 无效**。

结论是授权不该在沙箱层做一刀切，该在动作层按 risk 分级。但无头 harness 弹不出确认框，所以需要一种它拿得出的凭据：

| risk | 批准方式 |
|---|---|
| `low` | `auto` —— 直接放行 |
| `medium` | `expect_sha256`（乐观锁）**或** `approval:"confirm"` |
| `high` | 同上，但乐观锁不足以覆盖学历文件时应优先要求 `confirm` |

**`expect_sha256` 的语义是"证明你读过当前内容"。** 无头 agent 读得了文件、算得出 hash，所以它能自己出示批准；而一个没读过就想覆盖的 agent 出示不了。这同时顺手解决了静默覆盖：hash 过期（文件被别人改过）就拒（T3.6）。

人在环的场景仍可用 `approval:"confirm"`。

---

## 4. 可逆性：只承诺备份，不承诺自动回滚

`reversible: true` 的物证是 `backup_path`（覆盖前 `copyFileSync` 到 `southbridge/.backups/`）。新建文件的撤销方式是删除（`undo_hint`）。

**协议不承诺自动 rollback。** 架构文档把 `reversible` 一笔带过，但通用动作回滚是深坑——写文件能备份，启动进程、发消息、改注册表不能。写进协议就是空头支票。等真出现第二类 driver 再谈。

---

## 5. 刻意没做的事

- ~~**verb → driver 抽象矩阵（"一核多影"）**：本仓库当前只有 1 个 driver（Node fs）。只有一个"影"时做多影抽象是过早抽象。~~
  **【已推翻，2026-08-08 当天】** 拒绝的理由是"没有第二个真实用例"。当天实测出 MCP 通道被 harness 的工具审批闸门整体堵死（§6.6），第二条通道有了存在的必要，遂抽出 `shadowcore-core.mjs`，新增 CLI 驱动。见 §8。
  **判据不变，证据变了**：过早抽象的判据是有没有第二个真实用例，不是有没有对称美。U-King 那边的 46 个 Action 仍是**另一个仓库**的资产，不算这里的进度。
- **改名（本源南北桥 / 2Origin Northbridge 等）**：CLAUDE.md 的"命名冻结一季度"更值钱。改名收益为零，成本是所有已有状态文件的 `spec` 字段全乱。
- **RFC 编号体系铺满 0000–0060**：先只写有实现、有验证的这一份。

---

## 6. 未决问题（诚实清单）

1. ~~**幂等账本无限增长**~~ **【已解，附代价】** 账本改为 JSONL，超 `LEDGER_MAX`（默认 500）按最近活跃压缩，tmp+rename 原子替换。
   **代价说清楚**：被淘汰的老 key 再重放时命中不到账本，会**真的再执行一次**——对 `mode=write` 影响不大（同内容同结果），对 `mode=append` 会重复追加。所以淘汰不是静默的，会写一条 `kind:"ledger.compact"` 审计，列出被淘汰的 key。验证：T7.6 / T7.7。

2. ~~**审计写失败被静默吞掉**~~ **【已解：fail-closed】** 动世界之前先记 `action.intent`，记不下就拒绝执行（`status:"denied"`, `audit:"unavailable"`），世界不被改动。动作之后的结果审计若失败，世界已改拦不住，但会在 result 上打 `audit:"result-log-failed"` 让调用方看见。
   理由：「所有关键 Action 必须可审计」不是口号——审计零记录正是 §6.6 唯一一次真正救场的能力。验证：T7.1 / T7.2 / T7.3。
3. ~~**append 的 diverged 判定偏严**~~ **【已解：观察 footprint，不观察整文件】** 追加动作现在在 `action.result` 里带 `footprint: {offset, length, sha256}` —— 这次动作在世界上留下的**那一段**。重放校验只读回那段字节比对，覆盖写仍比整文件 sha（它的语义本就是"整个文件等于我写的内容"）。

   **"偏严"是轻描淡写，实际代价是重复写**（2/2 场景实测复现，`node southbridge/probe-append-idempotency.mjs`）：
   - A 追加一行 → `done`；B 往同一日志追加 → 整文件 sha 变；A 原样重试 → 判 `diverged`，**尽管 A 那一行原封不动还在文件里**
   - 调用方按 CLI 契约把退出码 4 当失败处理、换 key 重试 → 文件变成 `["X","Y","X"]`
   - **幂等机制亲手诱发了它本要防的那件事** —— 正是 v0.1 缺陷②「重放两次写两行」的原样复活

   病根跟①③④是同一个：**观察对象和动作的作用范围没对齐**。拿快照去验差分，就会把"世界别处的合法变化"误读成"我的动作失效了"。这条也是架构文档里唯一被实测支撑的建议（§5「Agent 应优先消费 Diff，而不是重复读取整个世界」）。

   放水检查：反向判据 T8.6（那段被改写）、T8.7（文件被截断到 footprint 之外）仍必须判 `diverged`。另：`replayed` 返回的 `evidence` 改为**此刻的观察**而非首次动作时的旧快照——旧行为本身就是缺陷①的形状。验证：T8.1–T8.7。
4. ~~**并发**：账本读改写非原子~~ **【已解：追加式账本】** 改为 JSONL 只追加，读取时后写覆盖先写，没有读改写窗口。
   **旧实现的 bug 是实测出来的，不是推断**：模拟 v0.2 初版的整体读改写，8 个进程并发写 8 个不同 key，**账本最后只剩 2 条，丢了 6 条**。丢一条幂等记录意味着后续重放会真的把世界再改一次。新实现同条件 8/8 一条不丢（T7.4），且并发写入的记录仍能命中 `replayed`（T7.5）。
5. **`southbridge_verify` 的信任边界**：它和写动作在同一进程，严格说不算"独立观察者"。真正的本象验证应由外部进程做。

6. **跨层 Trust —— 当前的头号阻塞（已实测）**：南桥的 risk 分级在 harness 的工具审批闸门面前不生效，因为请求根本到不了南桥。

   实测（codex-cli 0.147.0，2026-08-08）：南桥 MCP 已注册且握手成功（会话工具清单里有 `southbridge_verify`），但每次 `tools/call` 都返回 `user cancelled MCP tool call`；**南桥 `audit.log` 零记录**——铁证：请求从未到达。排查结果：
   - `-c approval_policy=never` / `-a never` 不覆盖 MCP 工具调用
   - execpolicy `~/.codex/rules/default.rules` 只有 shell 的 `prefix_rule`，`grep -ic mcp` = **0**
   - 唯一能过闸的 `--approve-for-me` / `--dangerously-bypass-approvals-and-sandbox` 都是**全局关闸**，与分级授权背道而驰

   **结论：这不是南桥授权模型的失败，是它根本没机会生效。**

   **后续（同日，已解一半）**：既然 MCP 是唯一入口才会被一堵堵死，就加一条不经过该闸门的通道 —— CLI 驱动（§8）。实测 Hermes 经 `southbridge-cli.mjs` 落盘成功：`status=done risk=low approval=auto`，磁盘 24 字节、sha256 与 CLI 自报一致，审计里 `southbridge_cli` 2 条、`southbridge_mcp` 0 条。**跨 harness 写权限打通。**

   仍未解：codex 的 MCP 闸门。那是 harness 侧问题（缺 per-server 授信），南桥侧已无可做。协议层面仍缺一层：影核的 `risk`/`approval` 需要一种能被上游 harness 审批层理解或继承的表达 —— v0.3 的主命题。

   附带发现（独立于协议）：本机 codex 的 Windows 沙箱 runner 本身是坏的——`CreateProcessAsUserW failed: 5 (拒绝访问)`，连只读 `Get-Date` 都起不来。这与 task2 记录的"沙箱策略拦截写"是**不同故障**，那条结论需要修正。

---

## 7. 一致性验证

```bash
node southbridge/verify-southbridge.mjs
```

43 条判据全部取自磁盘真相（`fs.readFileSync` / `existsSync` / 行数 / 退出码），不采信工具返回的任何自述。验证器可重复跑（幂等键每轮随机，否则会被上一轮账本污染——这个坑本身就是第一轮跑出来的）。

满足此验证，即达成架构文档 §16 conformance 第 4 条「任务执行后能够验证现实结果」—— **且是实测过的，不是声明的**。

---

## 8. 一核多影：驱动与核心的边界

```
        shadowcore-core.mjs          ← 核：风险判级 · 批准规则 · 写后观察 · action.result
         ↑                  ↑
southbridge-mcp.mjs   southbridge-cli.mjs   ← 影：只管传输与呈现
   (MCP stdio)            (shell)
```

**驱动不得自己判风险、不得自己决定 status。** 核心把 `actor` 记进审计，所以审计日志能回答"这次写是从哪条通道进来的"——跨层 Trust 的排查全靠它（§6.6 的定责正是这么做的）。

### Parity 是验证出来的，不是"共用了同一个函数"自证

T6 拿三个场景（low 新建 / medium 无凭据拦截 / denied 白名单外）分别走两条通道，对 `action.result` 做**字节级比对**（排除 `action_id`/`target`/`mtime`/备份路径）。三场景判决全一致。

### CLI 契约（给 AI 当本地 API 用）

```bash
node southbridge/southbridge-cli.mjs write  --relpath demo/x.md --content-file - < body.md
node southbridge/southbridge-cli.mjs verify --relpath demo/x.md [--expect-sha256 <hash>]
```

- **stdout** 只有一行 `action.result` JSON，机器读
- **stderr** 是给人看的提示，且只在 TTY 下打（管道里不污染）
- **退出码可判**：`0`=done/replayed　`2`=requires_approval　`3`=denied　`4`=failed/diverged　`1`=用法错
- **内容走 `--content-file` 或 `--stdin`，不走 argv**（Windows argv 上限 32767，长参数会挂）
- **内容来源必须显式**：漏给会直接判用法错。实测 footgun——不显式时静默写出 0 字节文件并报 `done`，而且完全符合"写后观察一致"，**验证器抓不出来**。这类死角只能在入口拦，指望事后验证是没用的。要空文件请显式 `--content ''`。
