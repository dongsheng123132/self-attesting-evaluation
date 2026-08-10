# Credentials, Not Transcripts: Verifiable Cross-Model Inheritance of Agent Task State

**Draft v0.1 — 2026-08-10.** Target: NeurIPS/ICLR workshop (agents & memory).
Companion to `self-attesting-evaluation-v0.2.md`, which is that paper's negative result;
this is the positive one. **Do not merge them** — this paper's claim is narrow and its evidence
is a single relay experiment; that paper's value does not depend on this one being right.

> **中文导读**：A 篇是「我们的评估装置骗了我们十九次」，这篇是「我们做成了一件事」。
> 主张只有一句：**模型是可替换的 CPU，学历在磁盘上，不在上下文里。**
> 值钱的不是结论本身，是**怎么让这个结论可以被证伪**——
> 让后一棒去复算前一棒的数字，而那个数字锚在只追加日志上，任何第三方能自己切片重算。
> 本文今天重跑了那次复算：日志从 2885 行长到 9151 行，两天前的历史切片仍分毫不差。

---

## Abstract

Agent continuity is usually implemented as transcript replay: to resume a task, you feed the
model what was said before. This does not survive a change of model or a change of harness,
because a transcript is a record of one conversation rather than a description of a task. We
report a relay experiment in which a single on-disk task document — not a transcript — was
handed between four models across three vendors inside one harness, and separately between two
harnesses, with each runner receiving a prompt containing **no description of the task**. The
methodological contribution is not the relay but its falsification design: the task was
constructed so that **each runner had to recompute a number produced by the previous runner from
an append-only log that any third party can re-slice**. Agreement is therefore not a judgement
about whether an artifact "looks right"; it is an arithmetic identity that an outsider can check
without trusting any agent's self-report. All four recomputations matched exactly, and still
match two days later with the log three times longer.

---

## 1. Introduction

Ask an LLM agent to resume yesterday's work and the standard answer is to replay yesterday's
conversation. This works, in the weak sense that the model usually produces something
appropriate. It fails in three ways that matter:

1. **It does not cross models.** A transcript is full of one model's idiom, its tool-call
   formats, and its mistakes. Another model must reconstruct the task from evidence about a
   conversation rather than being told the task.
2. **It does not cross harnesses.** Transcript formats are harness-specific, and the parts that
   matter (which files were written, what was verified) are interleaved with parts that do not.
3. **It grows without bound while the useful content does not.** The thing that actually needs
   to persist — the goal, the current state, the verified facts, the next steps — is small and
   nearly stationary. The transcript is neither.

The alternative is to persist a **credential**: a structured document describing the task rather
than the conversation. This is not a new idea in the abstract. What we contribute is a
demonstration under conditions strict enough to be falsifiable, and — more importantly — an
account of *what makes such a demonstration falsifiable at all*, because the obvious version of
this experiment cannot fail.

---

## 2. Why "the agent continued the task" is nearly unfalsifiable

Suppose you hand a task document to a fresh model and it produces a plausible next artifact. What
have you shown?

Almost nothing. A capable model handed *any* coherent document about a software task will produce
a plausible next artifact. It may be reconstructing the task from the document, or from generic
priors about what such tasks look like, or from the file names in the directory. All three
produce output that a reader — including the experimenter — will score as success. This is the
same defect our companion paper documents as a class of instrument failure: a success criterion
that no behaviour of the subject could have falsified.

Three specific traps:

- **Task leakage through the prompt.** If the handoff prompt describes the task even briefly, the
  document is no longer load-bearing.
- **Task leakage through the environment.** Directory names, file names and README content can
  carry the task. This one cannot be fully eliminated, only bounded and declared.
- **Plausibility scoring.** If the acceptance criterion is a human judging whether the artifact
  is reasonable, the experiment measures the model's fluency, not its inheritance.

Our first cross-harness test (§6) fell into a fourth trap: it changed the harness *and* the model
at the same time, so it could not support a claim about either.

---

## 3. Design: isolating the model as the only variable

The cross-model experiment (`demo/task5`) holds everything fixed except the model:

- **One harness** (a headless CLI agent), one machine, one working directory.
- **One task document**, `task.origin.json`, carrying goal, current state, verified facts with
  sources, decisions, artifacts and next steps.
- **Four legs, three vendors**: `deepseek-v4-flash` and `deepseek-v4-pro` (DeepSeek), `gpt-5-mini`
  (OpenAI), `kimi-k2.6` (Moonshot). Switching vendors inside one harness was possible only
  because the harness reads an OpenAI-compatible base URL from the environment; this is also the
  main limit on the result (§8).
- **A prompt that contains no task description.** The full text handed to each leg was:

  > Read `demo/task5/task.origin.json` and `AGENTS.md`, then continue with the step you are
  > responsible for. Do not ask me what the task is.

  Every leg identified its own step from the document and completed it, with no clarifying
  questions. This is recorded in the task document and its versioned backups; it is not something
  we can re-derive today, and §8 marks it accordingly.

That last point is the weakest part of the design and we want to be plain about it: "zero
clarifying questions" is an observation about a past interaction, attested by our own records.
The next section exists because we did not want the paper to rest on that kind of claim.

---

## 4. The falsification move: make the next runner recompute a third-party number

This is the part we think transfers to other work.

The task was constructed so that **leg B's job was to recompute leg A's numbers**, and so on down
the relay. The numbers are counts over an **append-only audit log** — every action taken through
the system's action kernel appends one JSON line, and lines are never rewritten. Each leg
reported a count over the first *N* lines, where *N* was the log length at its own time.

The consequence is that agreement between legs is not a judgement. Any third party can slice the
log to line *N* and recount:

```bash
node -e '
const fs=require("fs");
const all=fs.readFileSync("southbridge/audit.log","utf8").trim().split("\n");
const count=ls=>{const p=ls.map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean);
  return {cli:p.filter(j=>j.actor==="southbridge_cli").length,
          mcp:p.filter(j=>j.actor==="southbridge_mcp").length};};
for (const [who,n] of [["A",1517],["B",1662],["D",2665],["E",2885]])
  console.log(who, JSON.stringify(count(all.slice(0,n))));'
```

Three properties make this stronger than artifact inspection:

1. **The claim is arithmetic.** There is no scoring rubric and no judge. The count either matches
   or it does not.
2. **It cannot be satisfied by fluency.** A model that had not read the document could not know
   which line offset to slice at, and a model that guessed would produce a number that does not
   reproduce.
3. **It survives the passage of time.** Because the log is append-only, a historical slice stays
   valid no matter how much is appended later. A snapshot-based scheme would not have this
   property.

Property 3 is the one we can demonstrate rather than assert, so we did.

---

## 5. Results

| Leg | Model | Vendor | Slice | Reported | Recomputed 2026-08-10 |
|---|---|---|---|---|---|
| A | `deepseek-v4-flash` | DeepSeek | first 1517 | cli 806 / mcp 708 | cli 806 / mcp 708 ✅ |
| B | `deepseek-v4-pro` | DeepSeek | first 1662 | cli 893 / mcp 766 | cli 893 / mcp 766 ✅ |
| D | `gpt-5-mini` | OpenAI | first 2665 | cli 1490 / mcp 1172 | cli 1490 / mcp 1172 ✅ |
| E | `kimi-k2.6` | Moonshot | first 2885 | cli 1623 / mcp 1259 | cli 1623 / mcp 1259 ✅ |

**Four of four exact, on a log that has since grown from 2,885 to 9,151 lines.** The recomputation
in the right-hand column was run on the day this paper was written, by a different model in a
different session from any of the four legs, against a log that has been appended to by dozens of
unrelated sessions in between.

We separate what this establishes from what it does not:

- **Established, and re-derivable by anyone**: each leg reported a number that is an exact
  function of a log prefix, and those numbers are correct. A model that had not obtained the
  task's specifics from the document could not have produced them.
- **Recorded, attested only by us**: that each leg received the quoted prompt, asked no
  clarifying questions, and identified its own step unaided.

The first bullet is the paper. The second is context.

---

## 6. Cross-harness inheritance, and the bottleneck that was not where we thought

A separate pair of tasks (`demo/task2`, `demo/task4`) hands work between two different harnesses.
One harness performed a step and closed; a different harness continued from the task document
alone, with no transcript copied across.

The interesting result here is a negative one. We initially recorded the blocker as "the sandbox
is read-only." Re-testing showed that diagnosis was **wrong**: the second harness's write calls
never reached our action kernel at all — the kernel's audit log had zero entries for them. They
were stopped by the harness's own tool-approval gate, which its documented "no approval" setting
does not cover.

Two things follow. First, **the zero-entry audit log is what made the misdiagnosis correctable** —
an absence of records is evidence, but only if something guarantees records would otherwise
exist, which is why the kernel now refuses to act when it cannot write its audit line. Second,
the remedy was a plain shell CLI carrying the same kernel, which passes through the harness's
ordinary command path. We note explicitly that the alternative — the harness's global
"approve everything" flags — would have defeated the graduated-authorization design the system
exists to demonstrate, so it was not used.

---

## 7. What broke while we were proving it

During this very validation, the task document was destroyed and the relay continued on the
wreckage.

Leg D read the correct `content_hash`, then submitted a whole-document replacement containing one
fact and an empty current-state field. The optimistic lock compared hashes, found a match, and
accepted the write. Eleven verified facts, two decisions, six lessons and three artifact
registrations were lost; the file went from 5.6K to 1.9K. Leg E then continued from what
remained.

The lock was not broken. It was answering a different question than the one that mattered:

> **A hash lock proves freshness. It does not prove preservation.** Those are two invariants, and
> only the first had ever been named.

The deeper lesson is about the interaction pattern rather than the lock. Asking an agent to update
a shared document via read-modify-write silently converts the question *"what am I adding?"* into
the question *"what should this document look like?"* — and a model's answer to the second is
readily truncated. The system now enforces required fields, denies writes that shrink the verified
collections unless an explicit override is passed, and keeps a backup before every overwrite.

We report this here, in the paper whose result it threatens, rather than only in the companion
paper, because a reader deciding whether to believe §5 should know that the mechanism protecting
the evidence failed once during the experiment that produced it. The numbers in §5 are unaffected
for a specific and checkable reason: **they are anchored in the append-only log, not in the
document that was truncated.** That is not luck. It is the reason §4 was designed the way it was.

---

## 8. Threats to validity

- **One gateway, one API shape.** All four models were reached through a single OpenAI-compatible
  gateway. We have not tested native Anthropic or Google interfaces, so "cross-vendor" here means
  cross-vendor *models*, not cross-vendor *protocols*.
- **Environmental task leakage is bounded, not eliminated.** The working directory's names and
  the repository's other files carry information about the task. We reduced the prompt to a
  pointer, but we did not run the strongest control — the same relay with the task document
  replaced by an empty or unrelated one, which would show how much work the document is actually
  doing. **This control is not run, and until it is, §5 shows that the numbers were obtained,
  not that the document was necessary to obtain them.** We consider this the single most
  important missing experiment in this paper.
- **Two legs' records are post-hoc reconstructions.** Legs A and B lost their original write-ups
  in the incident of §7; the reconstructions are marked as such in the task document. The
  numbers are unaffected (§7).
- **The observer is not fully independent.** The verification step that reads back a written file
  runs in the same process as the write. A genuinely independent check requires an outside
  process, which is implemented for other parts of the system but not for this path.
- **A relay is not a workload.** Four legs of one task is an existence proof, not a measurement
  of reliability. We make no claim about how often this works.

---

## 9. Related work

Systems work on agent memory proposes architectures for what to retain and how to retrieve it —
MemGPT [3] manages tiered virtual context in the manner of an operating system, Mem0 [1]
extracts and consolidates conversational content — and evaluates them by downstream answer
quality. Liu et al. [2] give the canonical reader-side finding, that accuracy depends on where
in a long context the relevant span sits.

Our question is upstream of all three. We are not asking how well a model uses retained content;
we are asking whether the retained content is sufficient for a *different* model, in a
*different* process, to take over — and how such a claim can be made falsifiable at all. The
literature's standard instrument, downstream answer quality, is precisely the instrument that
cannot distinguish inheritance from fluency, which is why §4 does not use it.

---

## 10. Conclusion

A task document, not a transcript, was sufficient for four models from three vendors to run a
relay inside one harness, and for two harnesses to hand work to each other. The result we would
like carried forward is not that number but the design that makes it checkable:

> When testing whether one agent inherited another's work, do not ask whether the artifact looks
> right. Require the successor to recompute a quantity that is a function of an append-only
> record, and let a third party re-derive it.

That instrument cost nothing, survived the destruction of the primary evidence during the
experiment, and still returns the same four numbers two days and six thousand log lines later.

---

## References

Resolved against arXiv records on 2026-08-10 rather than recalled.

[1] P. Chhikara, D. Khant, S. Aryan, T. Singh, and D. Yadav. *Mem0: Building Production-Ready AI
Agents with Scalable Long-Term Memory.* 2025. arXiv:2504.19413.

[2] N. F. Liu, K. Lin, J. Hewitt, A. Paranjape, M. Bevilacqua, F. Petroni, and P. Liang. *Lost in
the Middle: How Language Models Use Long Contexts.* TACL, 2023. arXiv:2307.03172.

[3] C. Packer, S. Wooders, K. Lin, V. Fang, S. G. Patil, I. Stoica, and J. E. Gonzalez. *MemGPT:
Towards LLMs as Operating Systems.* 2023. arXiv:2310.08560.

---

## Appendix — reproduce it yourself

```bash
# The load-bearing claim of §5: recount the four historical slices
node -e '...'                                  # snippet in §4, runs against southbridge/audit.log

# The system's own conformance suites (run them; do not trust counts written in files)
node southbridge/verify-southbridge.mjs        # action kernel
node southbridge/verify-benjing.mjs            # persistent state, incl. the §7 truncation guard
node southbridge/verify-state.mjs demo/task5/task.origin.json

# Evidence integrity, anchored in Bitcoin block headers rather than our own clock
node governance/anchor.mjs verify
```

## TODO before submission

- [ ] **Run the empty-document control** (§8, bullet 2). This is the missing experiment that
      converts §5 from "the numbers were obtained" to "the document was necessary." Everything
      else on this list is cosmetic by comparison.
- [ ] Re-run the relay on a native (non-OpenAI-compatible) API to make "cross-vendor" mean
      cross-protocol
- [ ] Convert to the venue template; §5 and §7 are the load-bearing sections and should not be cut
- [ ] Second reader outside the project, specifically to attack §4's claim that recomputation
      cannot be satisfied by fluency
