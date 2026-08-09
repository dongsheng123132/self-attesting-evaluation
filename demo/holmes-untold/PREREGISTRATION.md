# 预注册：持久状态 vs 模型规模（华生未叙案件基准）

**状态：草案 v1，未生效。** 生效条件见 §10。**在本文件与 `SEAL.json` 一并提交之前，不得跑任何一次生成。**

> **Abstract (EN).** We test whether a persistent, protocol-structured task state lets a cheap model match or beat a frontier model that has no state. Instances are the "untold cases" Dr. Watson mentions but never narrates in the public-domain Sherlock Holmes canon. Design is a pre-registered 2 (model) × 4 (memory condition) factorial. The primary endpoint is *cross-instance consistency*, scored only against a **hidden** constraint set whose SHA-256 is committed before any generation runs. We publish the discard count and every failed cell regardless of outcome.

---

## 1. 主张与反主张

**H_A（我们的主张）**：给廉价模型配上协议化的持久状态（M3），其跨实例一致性优于同等 token 预算的原始聊天记录（M1）。

**H_0**：M3 与 M1 无差异——即所谓「协议」的收益其实只是「上下文更长」。

**必须一并检验的第三种解释**：M3 的收益只是「摘要写得好」。对照为 M2（等长静态 dossier）。

这三条不是修辞。若 M3 打不过 M1，我们的整套架构主张就是错的，本文件承诺照此发布。

## 2. 为什么要预注册

独立审视（codex，`demo/ulysses-19/reviews/codex-review-2026-08-09.md`）判定原设计有 **85% 概率**得出一个被构造出来的结论：有状态那一臂拿到判据清单与验证器反馈可反复爬分，对照臂裸跑，测到的其实是「答案表 + 搜索预算」。

预注册 + 隐藏判据是针对性解药。事后调判据是这类实验最容易、也最查不出来的作弊方式。

## 3. 实例

来源：柯南·道尔正典（4 长篇 + 5 短篇集，公有领域）中华生提及但从未展开的案件。

- 抽取器：`extract-instances.mjs`，命中 **32/32**，每条带卷名、篇名、行号与原文引语
- **确证集 24 条**：按 UC 编号升序取前 24
- **保留集 8 条**：UC25–UC32，本次实验不得使用，留作复现集

## 4. 因子设计（2 × 4）

**因子 A — 模型**：`deepseek`（廉价） / `frontier`（前沿）

**因子 B — 记忆形式**（全部等 token 预算）：

| | 条件 | 说明 |
|---|---|---|
| M0 | 无记忆 | 每个实例全新会话，只给任务提示词 |
| M1 | 等 token 原始聊天记录 | 前序会话的逐字记录，截断到与 M3 相同 token 数 |
| M2 | 等长静态 dossier | 人写/模型写的摘要，不走协议结构，token 数同 M3 |
| M3 | 本象协议状态 | `task.origin.json` + 北桥按目标检索 |

**M1 与 M2 是本设计的关键。** 只跟 M0 比，赢的可能只是上下文长度。

## 5. 等化（所有臂必须一致）

冻结的来源包 · 初始提示词（发布其 sha256）· 总输入/输出 token 上限 · 工具权限 · 有效生成调用数 · 修订次数上限 · 采样参数与随机种子。

**传输错误重试单列为仪器故障**，最多 3 次，全部记录；不得顺便多一次生成。任何未能完成的格子按缺失报告，不得静默丢弃。

## 6. 终点

**主要终点：H2 跨实例一致性。** 仅用隐藏集评分。5 条规则见 H（封存），内容在实验结束后公开。

一个臂内的实例**按固定顺序串行生成**，记忆逐个累积——这正是「持久状态」该起作用的地方。

**次要终点**：H1/H4 正典事实与编年冲突（14 条，均锚定到语料某一行）、H3 逐实例种子忠实（32 条）。

**操作检查（不是终点）**：可见集 V（6 条）。V 的通过率只反映「能不能照做」，生成方本来就看得见。

## 7. 分块与样本量

24 条确证实例分为 **4 块 × 6 条**；每块跑 **2 次重复**（不同实例顺序）。
每臂得 **8 个 H2 观测**。总生成数 = 8 臂 × 4 块 × 2 重复 × 6 实例 = **384 次**。

## 8. 分析计划

- **唯一的主要比较**：`deepseek-M3` vs `deepseek-M1`，按块配对，Wilcoxon 符号秩检验，α = 0.05 双侧；同时报效应量与 bootstrap 95% CI
- **次要比较**（Holm 校正）：M3 vs M0、M3 vs M2、`deepseek-M3` vs `frontier-M0`（这条是对外的头条，但它**不是**主要终点）
- 无中期分析，不看数据加样本，不改终点

## 9. 反证标准（写在前面）

若 `deepseek-M3` 相对 `deepseek-M1` 的 H2 改善其 95% CI 包含 0 或偏向 M1，我们发布的结论是：**「协议化状态未能优于等 token 的原始聊天记录」**，并保留全部数据。

同样，若 `deepseek-M3` 打不过 `frontier-M0`，我们不发「状态胜过模型规模」。

## 10. 生效条件

1. `SEAL.json`（H 的 sha256）已提交进 git —— **权威时间戳是那次 commit，不是任何字段**
2. 本文件已提交
3. 提示词模板与其 sha256 已提交
4. 污染基线实验（§11）已完成并公布

以上四条齐备之前，任何生成结果都不得作为证据。

## 11. 污染基线（必须先做）

福尔摩斯仿作在训练语料中极多。开跑前测量：各模型在 M0 条件下能否凭记忆复现正典细节与既有仿作情节。**污染率必须先公布**——若模型本就记得，H1/H3 的通过率就不再归因于状态。

## 12. 已知局限（不藏）

- **H2 的裁决部分依赖盲审**，非全自动。将报评审一致率（inter-rater agreement），一致率过低则该条判据作废
- **年代词汇闸是筛查不是判据**：Ngrams 测的是扫描库里的字符串频次而非词义级首见年，古拼写漏报、OCR 伪早现、同形异义无法区分。三值输出（seen / unseen / uncertain），uncertain 不计失败。在拿到 OED/EEBO 人工标注盲测集之前，不声称任何误判率
- **实例并非完全独立**：同一卷内的种子句共享语境
- **`frontier` 具体型号与版本必须在生效前写死并公布**，事后不得更换

## 13. 无论结果如何都会公布的东西

弃样数 · 每一个失败的格子 · 提示词哈希与随机种子 · 盲审分歧 · 假绿排查结果 · 本预注册的任何偏离及其理由。

> 不公布弃样数的实验，其失败模式与成功无法区分。
> —— `papers/self-attesting-evaluation.md`

---

## 附：封条

```
hidden_sha256 = 4a989f0ef06bcafd6be4113f0c75bfbcea1cee4a091266da130830cd32ddd160
主要终点     = H2
判据数        = 正典/编年 14、跨实例 5、种子忠实 32、未锚定剔除 0
```

核对：`node demo/holmes-untold/seal.mjs --verify`
重建：`node demo/holmes-untold/build-hidden.mjs --stdout`

H 不进 git，但构造脚本进。任何人都能重建 H 并核对哈希——藏一个谁也验不了的秘密文件，可信度反而更低。
