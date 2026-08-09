# RFC-0005 · 本境协议 v0.2（Benjing Persistent State Protocol）

**Spec ID:** `benjing/0.2`（状态文件字段写作 `2origin/0.2`）
**Status:** Draft — 参考实现已通过验证（`node southbridge/verify-benjing.mjs`，49/49，连跑两轮一致）
**取代:** 本境 v0.1（`schemas/task.origin.json` 初版 + 三个 hook）
**原则:** 学历的版本由**内容**决定，不由开过几次会决定；证据的成立由**能不能复核**决定，不由写没写决定。

---

## 0. 这版改什么，为什么改

同 RFC-0004 的规矩：只改在本仓库**实测复现过**的缺陷。架构文档给本境开的处方里，能绑上复现命令的只有下面六条；其余（SQLite 存储层、十类记录、改名为「本源北桥」、七层架构图）在本仓库没有对应的出血点，**不做**，理由见 §5。

| # | v0.1 实测缺陷 | 复现 | v0.2 对策 | 判据 |
|---|---|---|---|---|
| ① | 学历只加载最后一个扇区：磁盘 4 份学历 19 条已验证事实，开会只注入 9 条，另 10 条永不可见且无人知道 | `node .claude/hooks/load-state.mjs` 数注入条数 vs 遍历磁盘计数 | SessionStart 编译 **bundle**：当前任务全量 + 其余任务已验证事实结转，受字符预算约束，**丢了什么写在开头** | B1.1–B1.5 |
| ② | 自证式版本号：内容指纹一字未变，连跑 3 次 SessionEnd，`version` 1→4 | 沙箱单份状态跑 3 次 finalize，内容 sha256 不变而 version+3 | `version` 改由 `content_hash` 变化驱动；内容没变一个字节都不写 | B2.1–B2.5 |
| ③ | `verify-state` 的 CHECK2 是存在性检查冒充验证：把 9 条 source 全换成「我说的，不信拉倒」，判决仍是 ✅ VERIFIED | `node southbridge/verify-state.mjs <改过 source 的副本>` | source 必须**引用可复核物**（文件 / 命令 / 验证用例编号），否则判 `unverifiable` | B3.1–B3.5 |
| ④ | 学历无并发保护：两个 harness 各读各写，后写者静默吃掉前者的一条已验证事实，双方 version 都以为自己 +1，零告警 | 两次 read → 各 push 一条 fact → 两次 write，最终只剩后者 | `content_hash` 乐观锁；写学历必须走 `benjing-put.mjs --expect`，对不上判 `diverged` 且**磁盘不动** | B4.0–B4.6 |
| ⑤ | 无 provenance：`grep -c '"(actor\|model\|harness)"' demo/*/task.origin.json` = 0。「学历跨模型、跨 harness 继承」是本架构的核心主张，而状态文件里没有任何字段能为它举证 | 同上 grep | 顶层 `actor{harness,model,session_id,at}`，**观测不到的写 `unobserved`，不许编** | B5.1–B5.2 |
| ⑥ | 加载器按文件名认学历，把 `schemas/task.origin.json`（那份 JSON Schema 本身）也当成一份学历。它一旦 mtime 最新，SessionStart 会把 schema 当「上次任务状态」注入，SessionEnd 会往 schema 里塞 `version`/`updated_at` | 遍历结果里出现 `schemas/task.origin.json`，`kind` 为 `undefined` | 按 `kind === "task.origin"` 认，不按文件名认 | B1.4 / B5.3 |

### 缺陷②④不是推演，是当场撞上的

写这份 RFC 的会话进行到一半时，**另一个会话往 `demo/task3/task.origin.json` 追加了 4 条已验证事实**（facts 10–13，codex MCP 实验结果），而 `version` 仍是 `1`、`updated_at` 仍是三小时前的值。

后果两条，都实测到了：

1. 本会话开会时加载的是 9 条，盘上已经是 13 条，**没有任何机制告知上下文已过期** —— 版本号说不出「变没变」。
2. 若本会话按内存里那份（9 条）写回，facts 10–13 会被静默抹掉。这正是 ④ 的丢失更新，在真实仓库、真实并发下发生。

修复后重跑：`benjing-put.mjs --show` 立刻报 `in_sync: false`（内容与自记指纹不符 = 有人绕过协议改过），写回必须出示 `--expect`。

---

## 1. content_hash：学历的内容指纹

```
content_hash = sha256(canonical(state − {version, updated_at, content_hash, actor}))
```

`canonical` 是键排序的稳定序列化，保证同样内容在任何机器上算出同一个值。

**排除 `actor` 是刻意的**：否则换个 harness 原样存一次就让 version 通胀，那就是缺陷②换了个马甲（判据 B2.4 锁住这点）。

`version` 的语义随之变成「内容变过几次」，而不是「开过几次会」。旧值不追溯修正（task1=6、task2=12 保留原值），从 v0.2 起才有意义。

归档（`reconcile`）的三种结果：

| 结果 | 条件 | 动作 |
|---|---|---|
| `unchanged` | 自记指纹 == 实算指纹 | 一个字节都不写 |
| `bumped` | 不相等 | `version+1`，刷指纹 / `updated_at` / `actor` |
| `migrated` | 无 `content_hash`（v0.1 遗留） | 补指纹，**不涨版本号**——内容没变过，只是以前没记 |

---

## 2. 写入：乐观锁是唯一合法入口

```bash
node southbridge/benjing-put.mjs --show demo/task4/task.origin.json      # 拿凭据
node southbridge/benjing-put.mjs demo/task4/task.origin.json \
     --expect <hash> --from next.json                                     # 带锁写回
```

| status | 含义 | 退出码 |
|---|---|---|
| `done` | 内容确有变化，已写入并**回读校验指纹相符** | 0 |
| `unchanged` | 内容与盘上一致，未产生新版本 | 0 |
| `diverged` | `expect` 过期：期间有人改过。**磁盘一个字节没动**，交调用方合并 | 3 |
| `denied` | 写已存在的学历却没出示 `expect` | 4 |
| `failed` | 回读指纹不符 | 1 |

语义与影核 v0.2 的 `expect_sha256` 完全一致：**证明你读过当前内容，才准写**。影核对 `demo/` 下的普通文件都上了这把锁，而更贵的学历文件在本境层裸奔了整整一个版本——这是本次最该早点发现的疏漏。

写完必须回读比对指纹，不采信 `writeFileSync` 没抛错（B4.6）。实现过程中这条判据当场抓到一个真 bug：`putState` 先算指纹再改 `spec` 字段，回读必然对不上——**它自己犯了它要防的那种病**。

---

## 3. source 可复核：判形式，不判存活

判据是「**引没引可复核物**」，命中任一即可：

- 文件路径（`southbridge/verify-state.mjs`、`.claude/trace.jsonl`）
- 可重跑的命令（`node …`、`wc -l`、`git …`）
- 验证用例编号（`T3.2`、`B4.1`）

**不判「可复核物现在还在不在」**：不少 fact 描述的恰恰是「文件被删了 / 命令报错了」，要求路径存在会把真事实判成假（B3.3 锁住这点）。

拿真实学历回归：27 条已验证事实里 26 条通过，抓出 1 条真问题——task3 那条「C5 验证器本身是坏的」，source 写的是结论而不是复现方式。**修 source，不修检查器**：改成 `node southbridge/verify-state.mjs demo/task2/task.origin.json → 三个 artifact 全判缺失，退出码 1`，五份学历随即全绿。

**但也有该修检查器的一次**：这份协议自己的学历（task4）落盘后被判红，因为 source 写的是「验证用例 B4.0」，而规则集只认影核的 `T` 前缀。本仓库现在有两个验证器、两套用例编号（`T*` 影核 / `B*` 本境），规则集没跟上——这是检查器的漏，不是数据的漏，故把 `\bT\d+` 放宽为 `\b[TB]\d+`。

判别标准：**source 写的是「结论」就修数据，规则集「不认识一种真实存在的证据形式」就修检查器。**

---

## 4. bundle：开会时装载什么

SessionStart 不再抓一份，而是编译：

```
[本境 bundle · benjing/0.2]
装载 5/5 份学历 · 已验证事实 27/27 条
✔ 无丢弃

── 当前任务 · demo/task3/task.origin.json ──
目标 / 当前状态 / 已验证事实（全量）/ 关键决策（近 4 条）/ 下一步
── 其余任务结转 ──
[demo/task2] 6 条已验证事实 + 未完成待办
…
```

三条硬规矩：

1. **预算 9000 字符**（`additionalContext` 超万字会被落盘）。
2. **丢弃必须报**：装不下就写 `⚠ 未装载：demo/taskX 的 N 条（预算耗尽）`。静默截断会让人以为学历全在，那是比丢学历更坏的事。
3. **source 不可复核的事实照样装载，但打 `⚠source不可复核` 标记**——不替下游做删除决定，只标注可信度。

实测轨迹：v0.1 装 9/19 → v0.2 落成时 27/27（5436 字符）→ 学历涨到 54 条时**冲破预算，9400/9000，被兜底静默砍掉 400 字符，而头部还写着「装载 46/51」**。

这次翻车值得单独记：**预算核算漏算了自己**。header（含丢弃清单）和 footer 也占字符，却没进账；改成固定预留后又发现**丢弃清单会随任务数无限变长**，15 份学历时二次撑爆。跟「自证式版本号」是同一类错——**统计者把自己排除在统计之外**。

三条对策：

1. `RESERVE = footer 实际长度 + header 上界`，且头部的两个可变部分（丢弃清单、体检明细）**必须有上界**：条数照实报，明细只列前 4 项 + 「…等共 N 项」。
2. 结转任务的事实只带 `claim` 不带 `source`（source 往往比 claim 还长），且 claim 截断到 120 字。当前任务仍全量。
3. 兜底截断**永远不许静默**：真触发时在末尾写死「本 bundle 被硬截断，上面的装载计数不可信」。

修完实测 50/54（8738/9000），丢的 4 条如实上报。B1.6/B1.7 两条判据锁住这里：不许超预算，不许谎报装载量。

**然后同一个病换了个原因复发。** 学历涨到 76 条时，按 mtime 贪心填的策略让一份 27 条的大任务吃光了预算，task2 / uking-triage / heartbeat **三份被整份归零**（丢 25/76）。这正是 v0.2 要消灭的「学历沉底」——只是成因从「只读最后一个扇区」变成了「先到先得」。

改成**轮转分配**：一轮给每份学历放一条，转到装不下为止。超支时是大任务被截断，而不是小任务被抹掉。实测改后 55/76，无一份归零（task1 2/2、heartbeat 2/2、uking-triage 4/4、task2 5/6，只有 task3 被截到 7/27）。

判据 B1.8 锁的是**症状**（有学历一条都进不来），不是某一次的成因——否则下次它再换个原因回来，判据照样是绿的。

---

## 5. 刻意没做的事

- **SQLite + 向量索引 + Keychain 存储层**（文档 M3）：当前 5 份学历 27 条事实，纯文本 JSON 一次全读只花 5436 字符。上 SQLite 会立刻毁掉现在最值钱的性质——**学历能 `git diff`、人能直接读、AI 能直接改**。等条数上千、预算真的装不下再谈；到那时缺的也是检索层，不是存储层。
- **十类记录（fact/preference/decision/constraint/environment/procedure/skill/failure/evaluation/project_state）**：现有三类（facts / decisions / learnings）都还没填满，一次铺开十类得到的是十个空目录。新类别的准入条件是「有一条现存记录塞不进现有三类」。
- **改名为「本源北桥 / 2Origin Northbridge」、`benjing://` URI、七层架构图**：同 RFC-0004 §5，命名冻结一季度。收益为零，成本是全部状态文件的 `spec` 字段和 hook 路径全乱。
- **`context.request` / `context.bundle` 双对象协议**：采纳了「按预算编译，而非全量灌入」这个内核，但没造请求对象——当前唯一的消费者是 SessionStart hook，它不需要跟自己发请求。等出现第二个消费者（比如无头 harness 主动要 context）再定对象格式。
- **环境快照（CLAUDE.md 里的 Node/Git 版本）纳入本境**：实测本轮 `node -v` / `git --version` 与 CLAUDE.md 记的完全一致，**没漂移**。没出血就不动，等真漂移了再上 `as_of` + 重验机制。

---

## 6. 未决问题

### 6a. 落成后已关闭的三条

| 原编号 | 原问题 | 关闭方式 | 判据 |
|---|---|---|---|
| §6.1 | `actor.model` 拿不到真值，「换模型继承学历」无法自证 | 环境变量里确实没有，但**磁盘上有**：Claude Code 的 `~/.claude/projects/<slug>/<sid>.jsonl` 记 `"model":"claude-opus-5"`，codex 的 `~/.codex/sessions/…/rollout-*.jsonl` 的 `session_meta` 记 `"model":"gpt-5.5"`。新增 `observeModel()` 按 transcript → rollout → env 的顺序取值，并记 `model_source` —— **证据的证据**，观测到的和声明的不能混作一谈 | B6.1–B6.4 |
| §6.2 | `reconcile` 写盘非原子，崩在半路留半截 JSON | `writeAtomic()`：同目录临时文件 + `rename` 替换。8 个进程并发写 60KB 状态、读者高频读取，实测 0 次读到损坏 JSON | B7.1–B7.2 |
| §6.3 | 乐观锁只保护走 `benjing-put` 的写，Write 工具能绕过 | `PreToolUse` hook 硬拦截 `Write/Edit/MultiEdit/NotebookEdit` 对 `**/task.origin.json` 的写，退出码 2 + 提示改用 `benjing-put`。**实弹验证：本会话尝试 Write 一份学历，当场被拦，磁盘未产生文件** | B8.1–B8.5 |

新增便宜的每次归档体检（`health()`）：指纹是否自洽、source 是否可复核、artifact 是否还在。结果落 `.claude/benjing-health.json`，并由 SessionStart 当场重算后亮在 bundle 头部——**上一版的教训是「验证器坏了不知多久」，最便宜的那几条就该每次都跑**（B9.1–B9.2）。

### 6c. 第二道闸门：文件系统只读位（harness 无关，但只是半道）

`PreToolUse` 只在 Claude Code 生效。查过了——**codex 那侧做不出等价物**：`codex --help` 与 `~/.codex/config.toml` 里只有 `notify`（且只支持 `turn-ended`），没有工具级拦截钩子。

所以闸门下沉一层，落到文件系统：学历文件常驻只读（`0o444`），`putState` / `reconcile` 写前解锁、写后重新上锁，`reconcile` 顺带自愈（发现只读位掉了就补上）。

**实测边界（这是本节最该记住的部分）：**

| 写法 | 结果 |
|---|---|
| `fs.writeFileSync` 覆盖 | ✅ EPERM 被挡 |
| shell 重定向 `>` / `>>` | ✅ 被挡 |
| `rename` 覆盖（原子写路径） | ✅ EPERM 被挡 |
| `sed -i` 就地改 | ❌ **穿过去了** |

`sed -i` 是**删掉原文件再新建**（实测 `fs.unlinkSync` 对只读文件同样成功，且 sed 穿完把 mode 恢复成 444，不留痕迹）。所以准确表述是：

> **只读位挡的是「就地修改」，挡不住「删了重建」。**

判据 B10.5 是一条反向判据，专门把这个洞钉住：它主动验证「删了重建能绕过」。哪天这条变红，说明环境变了，整套闸门的强度要重估。

**这不是安全边界**，任何有权限的进程都能 `attrib -R`。它和乐观锁一样是**协作机制**：挡住不知情的写入者，剩下的交给检测。

**决定性实验没做成，如实记账。** 想验证 codex 的原生写路径（`apply_patch`）是走「就地修改」还是「删了重建」，两条路都堵：
- `codex exec -s workspace-write` → 本机 Windows 沙箱 runner 本身是坏的（`CreateProcessAsUserW failed: 5`，task3 早有记录），codex 根本没走到写文件那一步；
- `--dangerously-bypass-approvals-and-sandbox`（本可把文件系统闸门隔离成唯一变量）→ 未获授权，未执行。

所以「文件系统闸门能否挡住 codex」**目前是未知，不是已验证**。要跑通它，得先修好本机 codex 沙箱 runner，或由人明确授权那个旁路标志。

### 6d. sed 事故顺带挖出的盲区：体检对「消失的学历」是瞎的

测闸门时 `sed -i 's/task/TASK/'` 打穿了 task1，顺手把 `"kind": "task.origin"` 改成了 `"TASK.origin"`。后果不是「学历被改坏」，而是**那份学历直接从本境消失了**——`findStates` 按 `kind` 认，认不出就静默跳过，体检照报「全部健康」。

**比「被改」更危险的是「消失」**：被改还在账上，消失连账都没有。

修法：`scanStateFiles` 同时返回 `states` 和 `orphans`（文件名对得上但认不出的），体检把孤儿计入问题并亮在开会头部。判据 B9.3（`kind` 坏掉）、B9.4（JSON 解析失败）、B9.5（JSON Schema 本身不算孤儿——假阳性会把体检训练成噪音）。

事故本身也验证了一件事：**还原是精确的**。反向跑一遍 sed，实算 `content_hash` 与文件自记值相等，逐字节等同事故前——这正是 `content_hash` 该干的活。

### 6b. 仍然未决

1. **`reconcile` 的读改写竞态仍在**：`writeAtomic` 解决的是「半截文件」，**不是**「丢失更新」。两个进程同时 reconcile 同一份，后写的仍会盖掉前者的 `version` 递增。真正的解法是 reconcile 也走 `putState` 的 `expect`，但那样归档失败就得重试，尚未定策略。
2. **闸门对「删了重建」无效**（§6c），且**对 codex 是否有效未验证**。真正的跨 harness 强制点仍应下沉到影核（学历文件已在其受保护路径名单里），尚未接通。
3. **`diverged` 之后没有合并策略**：协议只负责拒写和告知，不提供 facts 三方合并。多 harness 常态并发后这是主要痛点。
4. **bundle 的筛选仍是「按 mtime 由新到旧塞到装不下为止」**：没有按当前 goal 做相关性排序。现在已经在真丢东西了（实测丢 4 条），但丢的是最老的任务，尚未出现「丢了正需要的那条」的实例——**等出现了再做，不然又是拍脑袋的相关性算法**。
5. **`source` 只验形式，不验重跑**：`node xxx.mjs` 这样的 source 没有真被执行过。
6. **`health()` 的 artifact 检查用 `existsSync`**：文件在但内容变了照样算通过。

---

## 7. 一致性验证

```bash
node southbridge/verify-benjing.mjs      # 49/49，沙箱在临时目录，不碰真实学历
node southbridge/verify-state.mjs demo/task3/task.origin.json   # 单份学历回归
node southbridge/verify-southbridge.mjs  # 影核未被本次改动破坏
```

49 条判据全部取自磁盘真相（文件字节数、`content_hash` 实算值、进程退出码、bundle 文本、hook 的 stderr），不采信任何函数的返回值自述。每轮用独立沙箱，可重复跑。

三条值得单独说明的判据：

- **B4.0 是反向判据**：主动复现 v0.1 的丢失更新。如果哪天这条「复现不出来了」，说明缺陷④的复现路径失效、其余判据的意义都要重估。全绿有两种可能——真修好了，或复现失效了，没有反向判据分不出来。
- **B1.7 会自己判「前提不成立」**：它要验的是「超预算时不许谎报装载量」。第一次写的时候造的数据根本没撑爆预算，判据在无效前提下通过了——现在它会明说「这批数据没撑爆预算，本判据前提不成立」而不是给个假绿。
- **B5.2 被改写过一次**：原文是「模型名观测不到时写 unobserved」，那锁的是 v0.2 落成时的**限制**而非协议的不变量；限制解除后判据当场变红。改为锁 `model` 与 `model_source` 自洽（无来源 ⟺ `unobserved`），这在两种世界里都成立。**判据要锁不变量，不要锁当时的能力边界。**
