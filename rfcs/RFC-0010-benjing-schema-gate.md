# RFC-0010 · 本境写入闸门强制 schema 校验

**Spec ID:** `benjing/0.2`（不升版本号：本 RFC 只收紧写入前置条件，不改状态格式）
**Status:** Draft — 参考实现已通过验证（`node southbridge/verify-benjing.mjs`）
**起因:** 红楼梦 C 轨（`demo/hongloumeng-c`）长路径实战中两次实弹命中，其中一次来自另一个 harness
**原则:** 校验器存在 ≠ 校验发生了。

---

## 0. 这版改什么

只改**实测复现过**的一条缺陷，不夹带。

| v0.2 现状 | 复现 | 本 RFC 对策 | 判据 |
|---|---|---|---|
| `putState` 做乐观锁、做必填字段与缩水检查，**唯独不做 schema 校验**。`schemas/task.origin.json` 这份 JSON Schema 存在，`southbridge/schema-check.mjs` 也能正确检出违规并退出 1——但写入路径上没人调用它 | `node demo/hongloumeng-c/repro-schema-gate.mjs`（洞开时退出 0） | 落盘前调用 `checkState`，违规判 `denied` 且**磁盘不动**，结果对象带 `schema_violations` 逐条列出 | B13.1–B13.5 |

---

## 1. 两次实弹，第二次来自另一个 harness

这不是设想的风险，是已经发生过两次的事故。

| 次序 | 写入方 | 违规内容 | 后果 |
|---|---|---|---|
| ① | `claude-code` | `artifacts` 写成 `[{path,what}]`，schema 要求 `string[]` | 写入返回 `done`；随后 `benxiang/reobserve.mjs` 与 `southbridge/verify-state.mjs` 双双 `ERR_INVALID_ARG_TYPE`，本象判据由 14/14 掉到 13/14 |
| ② | **`codex`** | `facts[61].source_kind = "path+command"`，不在允许集 `[file,command,testcase,trace,mixed]` 内 | 写入返回 `done`；全文件唯一一处不合规，**当时无人报错**，直到下一个会话手动跑 `schema-check` 才发现 |

### 第二次为什么更重

本仓已有一道 `PreToolUse` 硬拦截（`.claude/hooks/guard-benjing.mjs`），阻断 `Write/Edit/MultiEdit` 对 `task.origin.json` 的直写。但那道闸**只在 Claude Code 生效**。

codex 走的是合法通道（`benjing-put.mjs` 乐观锁），闸门放行，坏数据入盘。

> **缺陷的严重性不能只按本 harness 的暴露面估。**
> 跨 harness 协作会把这类洞的代价放大：本会话有守卫，别的会话没有。

---

## 2. 为什么现有的三道检查挡不住

`putState` 目前的写入前置检查有三层，都是被真事故逼出来的，但都不覆盖 schema：

1. **乐观锁** `expect` —— 证明「你读过盘上那份」，不证明「你写的还是一份学历」
2. **必填字段** —— 只查 `kind/id/goal/current_state/next_steps` 是否存在，不查字段**类型**
3. **缩水检查** —— 只查数组条数是否变少，不查数组元素的**形状**

两次事故都从这三层之间穿过去了：字段齐全、条数没少、`expect` 正确，只是**类型错了**。

---

## 3. 对策

在必填与缩水检查之后、落盘之前，调用已有的 `checkState`：

```js
import { checkState } from './schema-check.mjs';
// …乐观锁、必填、缩水检查通过之后
const viol = checkState(next);
if (viol.length) {
  return {
    status: 'denied',
    reason: `拒写：不合 schema（${viol.length} 处）。校验器一直存在，只是写入路径上没人调用它。`,
    schema_violations: viol,
    disk_unchanged: true,
  };
}
```

### 三个设计取舍

**不新增状态枚举。** 用现有的 `denied`，附 `schema_violations` 字段给出诊断。
新增枚举值会波及影核 `action.result` 的 status 集与既有判据，代价大于收益；
调用方要区分「没带 expect」与「数据不合规」，读 `schema_violations` 是否存在即可。

**不做自动修复。** 不替调用方猜 `path+command` 应该是 `mixed` 还是 `file`。
猜错会把一条错的 provenance 洗成看起来对的，比拒写更坏。

**不加旁路开关。** 不提供 `--skip-schema`。有开关的硬拦截等于没有硬拦截——
本仓已记录过「`--approve-for-me` 一开，审批闸门就形同虚设」的同类教训。

---

## 4. 兼容性

写本 RFC 时现跑了一遍全仓学历体检：

```
demo/ 下 16 份 task.origin.json —— 全部合规
```

故本硬拦截**不会锁死任何现有任务**。若将来出现存量不合规学历，处置办法是先用
`schema-check` 定位、人工修正后再写，而不是给闸门开口子。

---

## 5. 判据

| 编号 | 判什么 |
|---|---|
| B13.1 | 类型违规的学历被拒写（`artifacts` 用对象形式）→ `denied` 且磁盘不动 |
| B13.2 | 枚举违规的学历被拒写（`source_kind` 取允许集之外的值）→ `denied` 且磁盘不动 |
| B13.3 | 拒写结果必须带 `schema_violations` 且逐条指名字段路径（只拦不报等于没拦） |
| B13.4 | **反向**：合规学历不得被误拦（全仓 16 份现有学历逐份试写，均须放行） |
| B13.5 | **反向**：闸门补上后 `repro-schema-gate.mjs` 必须由 0 转 1（该复现器的语义就是「洞是否还开」） |

判据 B13.5 有个副作用需要显式记下：挂在旧经验
「校验器存在 ≠ 校验发生了」上的 `recheck` 期望的是退出码 0（洞开）。
闸门补上后该 recheck 会变红，学堂会把那条经验降级——**这是正确行为**：
那条经验描述的具体缺陷已经不在了。经验本身的普遍价值另行保留，
其 recheck 应改挂新判据 B13.5。

---

## 6. 不做什么

- **不做**「写入时自动补齐缺失字段」——那是替调用方编内容
- **不做**「把 schema 校验挪到 hook 层」——hook 只在 Claude Code 生效，正是本缺陷的成因
- **不做** 状态格式升版：本 RFC 不改任何字段定义，只收紧写入前置条件

---

## 7. 出处

- 缺陷复现器：`demo/hongloumeng-c/repro-schema-gate.mjs`
- 事故记录：`demo/hongloumeng-c/task.origin.json` 中 actor 为 codex 的 facts 及其 `corrected_by`
- 架构问题归纳：`demo/hongloumeng-c/FINDINGS-ARCH.md` §一
