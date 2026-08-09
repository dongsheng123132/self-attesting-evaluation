# cross-model-check — 跨模型复算审计

## 模型 A（deepseek-v4-flash，Hermes harness）

| 指标 | 值 |
|---|---|
| 统计时刻 (UTC) | 2026-08-08T10:27:07Z |
| southbridge_cli | 806 |
| southbridge_mcp | 708 |
| 全文件行数 | 1517 |
| 产物 | demo/task5/channel-stats.md |

## 模型 B（deepseek-v4-pro，Hermes harness）

| 指标 | 值 |
|---|---|
| 统计时刻 (UTC) | 2026-08-08T10:31:50Z |
| southbridge_cli | 893 |
| southbridge_mcp | 766 |
| 全文件行数 | 1662 |

## 比对

| 项目 | 模型 A | 模型 B | 差额 | 一致？ |
|---|---|---|---|---|
| southbridge_cli | 806 | 893 | +87 | 否 |
| southbridge_mcp | 708 | 766 | +58 | 否 |
| 全文件行数 | 1517 | 1662 | +145 | 否 |

## 分析

数字不一致，原因是 **audit.log 在两次统计之间新增了 145 行**（1662 - 1517 = 145，恰好等于 cli 差额 87 + mcp 差额 58 = 145）。

这**不表示跨模型继承失败**。恰恰相反：

1. 模型 B 仅凭 task.origin.json 的 current_state 与 next_steps 就读懂了 STEP-B 的任务
2. 模型 B 独立对同一数据源（audit.log）执行了 grep -c 逐行计数，而非盲信模型 A 的数字
3. 差异有完整可追溯的解释：两条 audit 记录各自对应一次 southbridge 操作（中间有其他会话正常使用南桥写入）

### 跨模型继承判定

- **任务理解**：✅ 模型 B 无需追问，仅凭状态文件即正确识别 STEP-B
- **方法复现**：✅ 模型 B 独立执行了与模型 A 相同的统计方法（grep -c 逐行匹配）
- **数字一致**：⚠️ 不完全一致，原因可追溯（audit.log 在两次统计间增长），不是方法错误
- **结论**：跨模型学历继承成立。模型 B 能续作模型 A 的任务，且能给出独立验证结果而非盲从
