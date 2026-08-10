# Self-Attesting Evaluation

> We built an agent-memory system, and the apparatus that was supposed to tell us whether it
> worked. The apparatus lied to us eighteen times. Every case, its trigger, its fix, and three
> retractions of our own published conclusions are in this repository.
>
> Three of the eighteen were found on the day we published, *by the act of publishing* — one of
> them a defect in the component we had just built to fix this paper's own stated weakness.

**📄 Two papers, deliberately not merged:**

- **[Self-Attesting Evaluation](papers/self-attesting-evaluation-v0.2.md)** — the negative result.
  Eighteen ways the evaluation apparatus lied, eight failure classes, 285 machine-checked judgments.
- **[Credentials, Not Transcripts](papers/credential-inheritance.md)** — the positive result,
  **carrying a retraction we wrote an hour after publishing it.** One on-disk task document carried
  a task across four models from three vendors; the numbers each model reported are honest and
  anyone can re-derive them. We had also argued the instrument *couldn't be fooled* — then checked
  the runners' own artifacts and found the discriminating quantity was obtainable by counting a
  file, with no inheritance at all. That claim is struck through in place (§4.1) and is case 18 of
  the first paper.

The second paper is therefore an existence proof plus an honest account of its own gap: the control
that would settle the question — the same relay with the document removed — **is not run**, and it
says so in its abstract rather than waiting for a reviewer to find it.

---

## The claim

An evaluation apparatus can fail in a way that is invisible from the outside, because the
component that would have to report the failure is the component that failed. Our central
finding is structural, not anecdotal:

> An evaluation that does not publish its own discard count and its own floor is not a weak
> evaluation. It is an evaluation whose failure mode is indistinguishable from success.

Eighteen failures collapse into eight classes. Each class is now a family of machine-checked
conformance judgments — **285 of them across nine specifications**, the majority negative cases
that fail if the guard does *not* fire.

Four of the eighteen are retractions of conclusions we had already published. The most
uncomfortable one used to be our first benchmark, which "proved" that a traditional harness cannot
resume a task without asking — the success criterion was `!tradCanResume`, and `tradCanResume` was
identically false by construction, so **the test could not fail**.

Case 18 is worse, and it is an hour old. It is *class C wearing the costume of rigour*: an
instrument that was checkable in every way we had learned to demand, measuring something other
than what we said it measured. Nothing was broken; the question we forgot to ask was **could this
number have been produced without the thing I am testing?**

## Verify it yourself

Nothing here asks to be taken on trust. Node.js ≥ 20, no dependencies for the core:

```bash
node southbridge/verify-benjing.mjs      # persistent state          67 judgments
node southbridge/verify-southbridge.mjs  # action kernel             53
node northbridge/verify-northbridge.mjs  # context compilation       38
node xuetang/verify-xuetang.mjs          # lesson promotion          33  (23 negative)
node oob/verify-oob.mjs                  # out-of-band probing       29  (24 negative)
node governance/verify-anchor.mjs        # evidence anchoring        23  (17 negative)
node benxiang/verify-benxiang.mjs        # world observation         14
node southbridge/verify-todo.mjs         # todo propagation          14  (11 negative)
node governance/verify-governance.mjs    # export boundary           14
```

Counts above were current on 2026-08-10. **Do not trust them — run the suites and read the
verdict line.** Hardcoding a count that drifts is case 9 in the paper, and these numbers went
176 → 273 → 285 inside two days.

## Why you can believe the timestamps

You cannot believe them because we say so. A commit date is written by the machine being
audited, and this repository had no remote for most of its life — every timestamp in it was
self-issued and locally forgeable. That is the paper's own thesis pointed at the paper.

So the evidence set is anchored externally:

```bash
node governance/anchor.mjs verify
```

`governance/anchors/` holds content-addressed frozen snapshots of the evidence set, each with an
[OpenTimestamps](https://opentimestamps.org) proof anchoring its hash into a Bitcoin block
header. The manifests contain **no timestamp field of their own** — a manifest that dated itself
would be the identical disease this project is about. Time comes only from the external proof.

What this buys: the listed file contents existed no *later* than a given block. What it does not
buy: that they existed no earlier, that they are true, or any coverage of the period before
2026-08-09. The paper says so in §6 and §8.

Each snapshot also states how many of its entries **you** can reproduce — an entry that was
uncommitted when it was stamped is one you can never check, and saying so is the whole point.
The first version of this component did not say so, and reported the gap as normal. That is
case 16.

## What this is not

It is **not** the claim that structured state beats transcripts. That is a separate and much
weaker-evidenced piece of work — single model, single task, controls written by us, no
comparison against published agent-memory systems. Do not merge the two. The value of this paper
is that it does not depend on that one being right.

## Layout

| Path | What |
|---|---|
| `papers/` | The paper |
| `rfcs/` | Component specifications (RFC-0004 … RFC-0009) |
| `governance/` | Export boundary, evidence anchoring |
| `benxiang/` | World observation — the only component permitted to hash or stat a file |
| `northbridge/` | Context compilation |
| `southbridge/` | Persistent state, action kernel, audit log |
| `oob/` | Out-of-band probes and cross-checking |
| `xuetang/` | Lesson promotion (candidate → verified only by examination) |
| `demo/` | Real tasks the system was run on |

Internal working notes are in Chinese (`CLAUDE.md`, `ACCEPTANCE.md`, the RFCs). The paper is in
English. This is a working repository, not a cleaned-up artifact drop — that is deliberate, and
§8 of the paper discusses what it costs the reader.

## License

- **Code** — Apache License 2.0 ([`LICENSE`](LICENSE)). Chosen over MIT for its express patent grant.
- **The paper and other prose** — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Reuse freely; attribution is a condition.

## Citing

The paper is a preprint under this repository pending venue. If you use the taxonomy, cite the
repository and commit hash until a canonical version exists.

---

## 中文

这是一台把 AI 学历跨会话、跨 harness、跨模型继承的机器，以及**它的评估装置骗了我们十八次的完整记录**。

论文卖点不是「我们做了个好系统」，是「每一次自欺的证据、修法和撤回都在盘上」——包括我们主动撤回自己
已经发布过的结论。九套判据共 285 条，多数是反向用例（守卫不响就红）。

证据不靠我们自己声称时间：`governance/anchors/` 里每个快照的哈希都锚在比特币区块头上，
清单本身**不含任何时间字段**——自己给自己写时间戳正是本文批判的那个病。

怎么用这套系统：见 [`CLAUDE.md`](CLAUDE.md)。怎么核实我们的主张：把上面那九条命令跑一遍。
