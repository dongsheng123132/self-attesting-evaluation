# channel-stats — southbridge/audit.log 渠道动作统计

统计时刻（UTC）: 2026-08-08T10:27:07Z（北京时间 2026-08-08 18:27:07）

| actor | 动作记录条数 |
|---|---|
| southbridge_cli | 806 |
| southbridge_mcp | 708 |

数据来源: `southbridge/audit.log`（共 1517 行；另有 3 条 `actor=shadowcore` 不在本统计口径内）

统计方式: 逐行匹配 `"actor":"southbridge_cli"` / `"actor":"southbridge_mcp"`，`grep -c` 计数。
