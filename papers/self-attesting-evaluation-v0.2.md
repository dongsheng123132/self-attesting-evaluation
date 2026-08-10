# Self-Attesting Evaluation: Seventeen Ways Our Own Agent-Memory System Lied to Us

**Draft v0.2 — 2026-08-10.** Target: NeurIPS/ICLR workshop (agents & memory, or evaluation methods).
Supersedes v0.1 (2026-08-09), which was a skeleton. This version is prose.
Judgment counts in §4 are from a live run on 2026-08-10 and must be re-pulled at submission.

> **中文导读**：卖点不是「我们做了个好系统」，是「我们的系统骗了我们十七次，每一次的证据、修法和撤回记录都在盘上」。
> 主动撤回自己结论的论文，可信度是买不到的。v0.1 的骨架已按 workshop 长度写成散文；
> §6 是新增的：论文 §8 自陈「证据由被记录者自己产生」这条弱点，本轮用外部时间锚做了部分修复——
> 而那个修复本身是从论文自己的规则推出来的。

---

## Abstract

Building an agent-memory system means building two things: the system, and the apparatus that
says whether the system works. We built both, and the second one failed seventeen times in ways
the first one could not detect — because in every case *the component that would have to report
the failure was the same component that failed*. We report each failure with a reproducible
trigger, the fix that shipped, and — for three of them — a public retraction of a conclusion we
had already published. We then collapse the seventeen anecdotes into eight failure classes, each
of which is now a family of machine-checked conformance judgments (285 across nine
specifications at the time of writing). Our central claim is structural rather than
anecdotal: **an evaluation that does not publish its own discard count and its own floor is not
a weak evaluation; it is an evaluation whose failure mode is indistinguishable from success.**

---

## 1. Introduction

An evaluation apparatus is a measuring instrument, and measuring instruments fail. The
interesting question is not whether they fail but whether their failure is *observable from the
outside*. A thermometer that reads 20°C in a 30°C room is wrong in a way you can catch by
holding a second thermometer next to it. A benchmark whose success criterion cannot be made
false by any behaviour of the system under test is wrong in a way that produces a number, a
plot, and a conclusion — all of which look exactly like a working benchmark.

This paper is a case study of the second kind, conducted on ourselves. Over roughly two weeks
we built an agent-memory system — persistent task state that survives across sessions, harnesses
and models — together with the benchmark and conformance apparatus that was supposed to tell us
whether it worked. Seventeen times, the apparatus lied. Not through carelessness that a code
review would catch, but through a specific structural asymmetry: **the component that was in a
position to observe a failure was the same component that had failed, and nothing required it to
speak.**

The count is itself data. It was eleven when the first draft was started and fourteen by the end
of that same day; three of those (cases 12–14) were found *while writing the paper about the
first eleven*, one of them inside the fix for case 8. Three more (15–17) were found the next day,
in the two hours spent preparing the artifact for public release — and case 16 is a defect in the
component built to remedy this paper's own stated threat to validity. We report the drift rather
than quietly renumbering, because the rate at which a taxonomy keeps finding new instances of
itself is evidence about the taxonomy. A reader should assume the true count is higher than
seventeen and that we stopped looking, not that we ran out.

We do not present this as a list of bugs. Bugs are uninteresting. We present three claims:

1. These failures have a **common shape**, and that shape is nameable, so it can be checked for.
2. The remedy is **not "be more careful."** It is to make loss a first-class output — a number
   that is emitted whether or not anything was lost, so that zero is a measurement rather than
   an absence.
3. The remedy is **executable**. Each of the eight classes we derive is now a family of
   conformance judgments that runs on every change, and the majority of those judgments are
   negative cases: they fail if the guard does *not* fire.

### 1.1 Why this is publishable rather than a changelog

Three properties, rare in combination:

**We retracted our own headline result.** Our v0.1 comparison benchmark concluded that "a
traditional harness cannot resume without asking." That conclusion was *constructed*, not
observed: the generated transcript never contained the goal or the next-step text verbatim, so
the predicate `tradCanResume` was identically false, and the success criterion was
`!tradCanResume`. The test could not fail. We found this ourselves, downgraded the conformance
item that carried it, and left the retraction in the repository (§3.1, case 1).

**The failures span two independent subsystems** — the benchmark harness and the persistent-state
layer — with the same shape. That rules out "we were sloppy in one file" and argues for a
structural cause.

**The remedy is executable, not advisory.** It is 285 machine-checked conformance judgments
across nine specifications, and each one is traceable to the failure that motivated it.

---

## 2. The system under study

Enough detail to read the cases, no more.

The system is a persistent-state layer for LLM agents. A task's state lives in a single JSON
document containing a goal, a current-state summary, verified facts (each carrying a `source`
that must cite a rerunnable artifact), decisions, actions, artifacts, learnings and next steps.
A context compiler reads those documents at session start and compiles a bounded bundle into the
model's context. Writes go through an optimistic lock: a writer reads the document, gets a
`content_hash`, and submits a new version with that hash as an expectation.

Around this sit five other components, each with its own specification and conformance suite: a
world-observation component (the only implementation permitted to hash or stat a file — see
§4, class G), an action kernel with an append-only audit log, an out-of-band prober that
observes the machine rather than the credentials, a lesson-promotion component, and a governance
layer that decides what may leave the machine.

Two properties of the setting matter for what follows. First, **multiple sessions run
concurrently against the same files** — this is the normal operating condition, not an edge
case, and it is the trigger for cases 8 and 10. Second, **the apparatus and the subject share
authors and a repository**, which is precisely the condition under which self-attestation is
cheapest and least noticed.

---

## 3. Seventeen failures

### 3.1 Benchmark harness

| # | Failure | Trigger / evidence | Fix shipped |
|---|---|---|---|
| 1 | **Constructed conclusion.** v0.1 compare-bench "proved" a traditional harness cannot resume. The generated transcript never contained `goal` or `next_steps` verbatim, so `tradCanResume` was identically false — and the success criterion was `!tradCanResume`. The test could not fail. | Re-run `genTranscript`: transcript contains goal verbatim = false, contains step verbatim = false ⇒ success ≡ true. `bench/RESULTS-v2.md` | Conclusion retracted; conformance C9 downgraded to a mechanism unit test; C10 created to carry the evidence |
| 2 | **Leakage: the floor arm scored 3/3.** Not position bias — *length*. The target task had been worked longest, so its fields were longest, and "pick the longest option" won. | v0.2 run: empty-context arm 100% on state-field questions (chance 25%) | Distractors length-matched; correct position rotated A→B→C→D; floor fell to 0%. Automatic check: if the empty-context arm beats chance by >25pp on any n≥8 metric, that metric prints as **unusable** |
| 3 | **We gagged our own control group.** The summary arm's prompt said "at most N characters"; it wrote 2,735 of a 9,635-character budget. Adding a lower bound made it fill the budget — and its score jumped 26.7% → 60.0%. | `bench/RESULTS-v3.md` | Control-arm payloads asserted within 30% of the state arm's budget before scoring |
| 4 | **An empty control got cached.** One summary-merge call returned empty content (a reasoning model spent its budget on reasoning tokens). The empty string was written to cache, so every subsequent run silently evaluated a *blank* control while the report still printed "summary arm". | `bench/RESULTS-v3.md` | Short outputs throw rather than cache; caches validated on read and deleted when bad |
| 5 | **The scorer counted its own truncation as the subject's error.** Answers cut off at `max_tokens` were scored as wrong. | v0.3 first live run: 16 calls with `finish_reason=length` | Truncated calls re-run at 3× cap; the repair count is printed. *Repairing without saying so is the same disease as truncating without saying so* |
| 6 | **One `ECONNRESET` aborted a 474-call experiment.** A run that dies unevenly biases the record toward the runs that happened to survive. | v0.3 live run, stack trace exit | Exponential backoff on transport errors and 5xx/429; 4xx throws immediately, because retrying an auth error hides it |
| 7 | **A failed probe that looked like a result.** Two-hop questions were added to break the open-book ceiling. All six arms landed within 58.0–71.4%, and the empty-context floor (63.8%) sat 0.5pp from the state arm (64.3%). The probe measures topical similarity, not state attribution. | `bench/RESULTS-v3.md`, Wilson 95% intervals overlapping across all six arms, n=23 | Metric retracted in the same report that introduced it; left in the table for transparency, supporting no conclusion |

Cases 2 and 3 deserve a note together, because they are mirror images. In case 2 the *floor*
was too strong; in case 3 the *control* was too weak. Both were produced by the experimenters'
own plumbing rather than by the phenomenon, and in both the number that resulted was
publishable-looking. The floor scoring 100% on a 25%-chance task is loud enough that we caught
it. A control that quietly writes 28% of its allowed budget is not loud at all, and we caught it
only because someone asked why the summaries looked short.

### 3.2 Persistent-state layer

| # | Failure | Trigger / evidence | Fix shipped |
|---|---|---|---|
| 8 | **Verification checked the form of evidence, not the evidence.** A fact's `source` was validated for *citing* a rerunnable artifact. Replacing all nine sources in a state file with nonsense still returned VERIFIED. For a further period it still never checked whether the cited artifact resolved: when a concurrent session deleted two log files, six sources went dangling and the checker stayed green. Both times a human found it by accident. | RFC-0005; `recheckSource` (form) vs `dereferenceSource` (referent); judgments B3.1–B3.4, B12.1–B12.8 | Dereferencing added. **It reports, it does not judge** — a fact whose subject *is* a file's absence must not be flipped to false (locked by B3.3). Six of eight new judgments are negative cases, because the first implementation produced 26 false alarms out of 32 (§4, class F) |
| 9 | **The bundle under-reported its own losses.** The context compiler dropped 28 of 96 facts while its header announced a load count. Later: the header and footer were not counted against their own budget, so the bundle overshot and was silently trimmed. | RFC-0006 §0; RFC-0007 | Every drop declared in the bundle text ("5/17 facts not expanded"); reserve computed from the actual footer length |
| 10 | **The optimistic lock passed a legal but truncated write.** A model read the correct `content_hash`, then submitted a payload containing one fact and an empty `current_state`. The hash matched, so the write was accepted. 11 facts, 2 decisions, 6 learnings and 3 artifacts were destroyed; the file went 5.6K → 1.9K. A later session continued on the wreckage. | `demo/task5` incident record (reconstructed after the fact); judgments B11.0–B11.5 | **A hash lock proves freshness, not preservation** — different invariants, only the first was implemented. Required fields now enforced; a drop in verified-fact count is denied unless an explicit `__allow_fact_loss` switch is passed (itself excluded from the state and from the hash). B11.0 replays the original incident as a standing negative case |
| 11 | **Nothing ever observed the machine.** The boot health check covered credentials (orphans, hashes) and not the environment. A misattributed root cause — "the sandbox read-only policy blocked the write" — survived as `verified: true` for an entire task cycle. The real cause was an approval gate plus a broken sandbox runner. | `demo/task2` facts[4] still `verified:true`; `health()` covers states/orphans only | Out-of-band probes added (29 judgments, 24 of them negative); a cross-checker reconciles claimed state against the audit log and against disk |

Case 10 is the one we would most want a reader to take away, because the defect is not in the
implementation of the lock — the lock worked exactly as specified. The defect is that
"the document you are overwriting has not changed since you read it" and "the document you are
writing preserves what the document you read contained" are **two different invariants**, and
only the first had ever been named. A hash comparison is a complete implementation of the first
and a null implementation of the second. Nothing in the code was wrong; something in the
specification was missing, and the specification was the thing nobody was checking.

### 3.3 Found while writing this paper

| # | Failure | Trigger / evidence | Fix shipped |
|---|---|---|---|
| 12 | **The rule was written down, then applied to two of its three sites.** The conformance sandbox copies component directories wholesale, with a comment saying exactly why: *"enumerating individual files necessarily lags behind dependency growth — the previous three incidents were all a sandbox that missed a newly added cross-component dependency."* Two directories were converted; the third was left enumerating one file. A concurrent session added a new module, the state layer imported it, and the entire suite died with `ERR_MODULE_NOT_FOUND` the same day. **Fourth recurrence of a defect whose remedy was already written in the file.** | `southbridge/verify-benjing.mjs:56`; the comment it violated sits three lines above | Whole-directory copy |
| 13 | **A judgment asserted a contract that had already changed.** The shrink guard was generalized from "protect `facts`" to "protect five collections", and its denial payload changed from `facts_before`/`facts_after` to a `shrunk[]` array. The judgment kept asserting the old field names. It failed — reading as *the guard is broken* when the guard was fine and the assertion was stale. | judgment B11.3 failing with `undefined→undefined` | Judgment updated; B11.3b added, because the generalization to five collections had shipped with no judgment of its own |
| 14 | **A policy was stated in the same commit that violated it, and its enforcement mechanism was inert.** A corpus policy declared that session transcripts must not enter the public repository; two artifacts derived from those transcripts were committed anyway. Separately, `.gitignore` was a single line containing the literal characters `\n` — so it had never ignored anything since the repository was created. The audit log stayed out by luck, not by the guard. | commit `0015ba1`; `od -c .gitignore` showing `\` and `n` as two characters | Derived artifacts untracked and ignored; `.gitignore` rewritten as real lines. History deliberately **not** rewritten — the content carries no personal data, and rewriting public history to hide a disclosed mistake is the opposite of this paper's thesis |
| 15 | **A policy whose scope was never written down.** The repository states that outbound evidence must go through a redacting export path, and that path is real: it strips local paths, emails, IPs and tokens, and is locked by 14 judgments. But it governs *state documents*, and nothing governs *the repository itself*. Running the same redactor over every tracked file returns 2,610 absolute local paths and a personal email address. We cannot tell from the artifact whether the repository was ever intended to be in scope — **and that is the finding**: the policy has an enforcement mechanism and a stated subject, but no stated boundary, so the question of whether it applied here was never asked by anyone. | `governance/policy.mjs` `redactOperationalText` run over `git ls-files`, 2026-08-10: 2,610 `local-path`, 6 `email` (4 real, 2 test fixtures), 1 `ip`, 1 `token` — the last three all inside the redactor's own test fixtures | **Not "fixed."** The four real email occurrences are a deliberate contact address for a public bounty page, and the local paths sit in append-only ledgers and in versioned state backups that are themselves this paper's evidence. Scrubbing them would rewrite the record this paper rests on. Recorded as a scope decision, not a defect to be patched |

| 16 | **The anchor attested to bytes nobody outside could obtain.** The evidence-anchoring component of §6 observes the *working tree*; what a reader receives is the *committed tree*. Concurrent sessions keep the working tree permanently dirty, so a manifest stamped from it cannot be reproduced by anyone who clones. Worse, the verifier printed the mismatch as `已变 12（只追加账本会变，正常）` — "12 changed (append-only ledgers grow, normal)". **The instrument explained its own unreproducibility as expected behaviour.** | First clone of the repository to a second location, immediately before first publication: of 129 anchored entries, 12 differed and 5 did not exist at all | Every entry now carries `repro` ∈ {`git`, `uncommitted`, `untracked`, `unknown`}, and each snapshot carries `git_head` plus `reproducible_from_git`. Following class E the remedy **declares rather than refuses**: the current anchor states 121/133. `unknown` is used when the root is not a git repository — not knowing is reported as not knowing, locked by a negative case (A7.1). The verifier now reads the count the snapshot recorded instead of inferring it, because inference is what produced "normal" |
| 17 | **A session transcript sat in every commit, under a policy whose first line forbids exactly that.** The repository's `.gitignore` opens with *"chat transcripts are shadows, not state — by this repository's iron rule they do not enter version control"*. The baseline commit that placed the machine under version control also added an 84 KB exported ChatGPT conversation, including its private share URL. It was present in all 21 commits, and would have been published. **Third recurrence of the class-14 shape** — a rule with a mechanism, stated in the file that the violating artifact sits next to. | Pre-publication inspection of every tracked file over ~50 KB; `git log --follow` shows it entering at the baseline commit and never leaving | Stripped from all history before first push (legitimate here precisely because nothing had been published yet), ignore rule added. The manual removal is six steps and omitting any one of them — especially purging `refs/original` — leaves the blob reachable while *appearing* removed, so the procedure is now one command with a gate that scans **all reachable objects**, not the working tree, and refuses to push on a hit |

Case 15 is the weakest of the seventeen and we include it deliberately. The other sixteen are
defects: something was supposed to happen and did not. Case 15 is an *absence of a decision* —
a rule with a mechanism, a subject, and no boundary. It resolves either way (the repository is
in scope and needs a gate; or it is out of scope and that should be written down), and until
someone writes the boundary down, the two readings are indistinguishable from outside. That
indistinguishability is the same property the other fourteen have, which is why it is here.

---

## 4. Taxonomy: from seventeen anecdotes to eight judgment families

The seventeen collapse into eight failure classes. Each class is now a machine-checked judgment
family, and this table is the paper's contribution.

| Class | Cases | Judgment that would have caught it |
|---|---|---|
| **A. The check tests the form of the evidence, not the evidence** | 8, 10 | A verification must dereference what it cites, and must compare *before* against *after*, not merely validate the request |
| **B. The measurement's own failure is scored as the subject's failure** | 1, 5, 16 | A test whose success criterion cannot be made false by any behaviour of the subject is void. Instrument failures (truncation, transport, empty payload, unreproducibility) must be a third outcome — never "wrong", and never "normal" |
| **C. Nobody measured what happens when there is nothing to find** | 2, 7, 14 | Every metric ships with an empty-context arm; every guard ships with a negative case that fails if the guard does not fire. A floor above chance condemns the metric, not the arm — and a guard that has never fired is indistinguishable from a guard that is inert, which `.gitignore` had been since the repository was created |
| **D. The control was weakened by the experimenter's own plumbing** | 3, 4 | Control-arm payloads are asserted against the treatment's budget before any score is computed |
| **E. Loss is real but never declared** | 6, 9, 11, 16 | Any component that drops, trims, retries or skips must emit the count. Silence is read as full coverage — which is a lie with no author |
| **F. The remedy fires on everything, so it measures nothing** | the first cut of the fix for 8; the first run of the cross-checker (11) | A new checker ships with negative cases that fail if it flags legitimate inputs, and its own first-run false-positive rate is part of its report |
| **G. A reference outlives its referent** | 8's trigger, 13 | Renaming and contract changes are first-class propagating operations, not edits. The cheap approximation, until that exists, is that every reference is dereferenced by something that runs |
| **H. The rule was written down and applied to a subset of its sites** | 12, 15, 17, and the context bundle that budgeted everything except itself | When a rule is stated, the same change enumerates every site it applies to — and states the boundary of the set. A defect that recurs N times is not N instances of carelessness; it is one missing component, and the recurrence count measures how long we have been paying for it |

**Class F deserves emphasis because we produced it twice, and the second time was while
preparing this version.** The dereference check added for case 8 flagged 32 of 149 verified facts
on its first run; 26 were artifacts of its own path-extraction regex. Shipped as-is it would
have made the health indicator permanently red, which is indistinguishable from having no
indicator. The rule that survived is narrower: *a vanished path matters only when the path is
the sole rerunnable item in that source.*

The second occurrence: while writing the conformance suite for the anchoring component described
in §6, we wrote a judgment asserting that the exclusion statistics leak no filesystem paths. Its
first implementation tested for the presence of sensitive-looking substrings — and the exclusion
*rule identifiers* are themselves named `corpus` and `hidden-judgeset`. The judgment fired on
its own vocabulary. It was rewritten to assert structure instead of keywords: the keys must be
drawn from the declared rule set and the values must be integers. **We had written class F down,
in a file we had open, and produced it again three paragraphs later.** We consider this the
single most useful datum in the paper, and we discuss it in §8.

At the time of writing we run **285 such judgments across nine specifications**: state 67, action
53, context 38, lesson-promotion 33, out-of-band 29, evidence-anchoring 23, world-observation 14,
todo-propagation 14, governance 14. Where a suite reports its own breakdown, negative cases are
the majority (out-of-band 24/29, lesson-promotion 23/33, evidence-anchoring 17/23,
todo-propagation 11/14). **Each was written after a failure, not before.** We consider that
provenance the interesting data rather than an embarrassment: it records which invariants are
discoverable only by being violated.

---

## 5. The generalizable claim

Every one of the seventeen has the same shape: **a component was asked to report on a failure that
only it could see, and it was not required to.** Stated as a design rule:

> Anything that can discard must publish its discard count.
> Anything that can measure must publish its floor.
> Anything that verifies must dereference.
> Anything that guards must be shown firing.
> Anything that is referenced must learn when its referent changes.
> Any rule worth writing in a comment is worth applying to every site in the same change —
> and worth stating the boundary of that set.

The corollary is uncomfortable and, we think, correct: **a system that reports "no problems"
without reporting how it looked is indistinguishable from one that did not look.**

Two of these six are not about detection at all, and they are the ones we keep re-learning. A
rename is not an edit — it is an event that other things depend on, and nothing in an ordinary
toolchain tells the dependents (class G). A rule stated once and applied twice out of three
times is not 2/3 fixed; it is a defect with a longer fuse (class H). Both are cases where the
honest instrument exists and still loses, because **the information needed to act was in a
different place from the action.**

### 5.1 What the rule costs

We should be explicit that this is not free, because a rule that is free is usually a rule that
does nothing.

Publishing discard counts makes output noisier: a bundle that used to say "loaded" now says
"loaded, 5/17 facts not expanded, header reserve 412 bytes." Requiring negative cases roughly
doubles the size of a conformance suite — of the four suites that report their own breakdown,
negatives are 72 of 121 judgments. Requiring that a guard be shown firing means every guard
needs a synthetic violation constructed and maintained. And requiring dereference turns cheap
syntactic checks into I/O.

The cost we did *not* anticipate is class F: each new checker is itself a component that can
fail silently in the one direction its own output cannot show — by firing on everything. That
cost is recursive and we have not found a bottom to it. What we have found is that it is bounded
in practice by the same rule applied one level up: a checker ships with its own first-run
false-positive rate in its report.

---

## 6. Remedy for self-attested evidence: external anchoring

The first version of this paper listed, among its threats to validity, that half of its evidence
was not under version control, and that the surviving record was produced by the same component
whose behaviour it documents. That is the paper's own thesis pointed at the paper. This section
reports what we did about it, because the remedy follows from §5 rather than from good intentions.

**Step one, 2026-08-09: the working repository was placed under version control.** This fixes
"the evidence is not versioned" and fixes nothing else.

**Step two, 2026-08-10: the evidence was anchored externally.** The residual problem is that a
git commit date is written by the machine being audited. On this repository there was no remote,
so every timestamp in the record was self-issued and locally forgeable. We therefore built a
component that enumerates the evidence set under explicit include/exclude rules, observes each
file through the single world-observation component, and emits a manifest — which is then
submitted to OpenTimestamps and anchored in a Bitcoin block header.

Four design decisions, each of which is one of the classes above pointed at ourselves:

- **The manifest contains no timestamp field.** Time is carried only by the external proof. A
  manifest that dated itself would be the identical disease this paper is about. A conformance
  judgment fails the build if any date-shaped string appears in it.
- **Anchors are content-addressed frozen snapshots, not an updated-in-place file.** Append-only
  ledgers grow constantly, so a manifest that tracked "now" would invalidate its own proof within
  minutes. Snapshot filenames are the content hash and contain no date, because a filename with a
  date in it is still self-attested time (class A: the name is the form, the hash is the referent).
- **Pruned subtrees are counted separately from excluded files.** Reporting an entire excluded
  directory as "1 path" would be class E in the remedy for class E.
- **An unstamped manifest exits non-zero.** If no external anchor exists, the verifier returns a
  distinct failing status rather than green — class C, applied to the anchoring component itself.

The component ships with 19 judgments, 14 of them negative.

**What this does and does not buy.** It establishes that a given set of file contents existed no
later than a given Bitcoin block. It does not establish that they existed no *earlier*, it does
not make the contents true, and it does not retroactively cover the period before 2026-08-09.
At the time of writing, the three anchors are calendar commitments pending block confirmation,
which is a weaker claim than a confirmed anchor and we state it as such rather than reporting
"anchored."

---

## 7. Related work

The context- and memory-engineering literature — write policy, storage tiering, retrieval
strategy, placement, budget — is prescriptive about *reader-side* failure: retrieval without a
token budget, lost-in-the-middle placement, and stale retrieval. Our seventeen are almost entirely
*writer-side* and *world-side*: facts that decayed, renames that did not propagate, concurrent
writes that passed the lock, discards that were never declared, checks that verified the form of
evidence rather than the evidence.

That asymmetry is itself a finding. **Reader-side defects present immediately as a wrong answer,
so they can be reasoned about a priori. Writer-side defects sit quietly on disk for months.**
They are found by accident, by an independent observer, or not at all.

Concretely: systems work on agent memory proposes architectures and then measures how well the
agent answers afterwards. MemGPT [6] manages tiered virtual context in the manner of an operating
system; Mem0 [2] extracts and consolidates salient conversational information and is evaluated on
LOCOMO across four question types. Both evaluate the *reader*. Liu et al. [5] give the canonical
reader-side result — accuracy degrades when the relevant span sits in the middle of a long
context — and it is a reader-side result precisely because it is visible in the answer. None of
our seventeen would appear in an end-to-end answer-quality score, because in each case the state
that reached the reader was internally consistent; it was merely wrong about the world, or
smaller than what had been written, and nothing said so.

**Benchmark validity.** Bowman and Dahl [1] argue that NLU benchmarking is broken because
unreliable systems score too highly, leaving no headroom to demonstrate real progress; Raji et
al. [7] attack the construct validity of benchmarks treated as general measures of intelligence.
Both critique what a benchmark *measures*. We are asking a narrower and prior question: whether
the apparatus is capable of reporting that it failed. A benchmark with poor construct validity
still produces an honest number about something. Our case 1 produced a number that no behaviour
of the subject could have changed.

**Leakage.** The closest relative is Kapoor and Narayanan [4], whose taxonomy of eight leakage
types across 329 papers in 17 fields is the model we followed in collapsing anecdotes into
classes. The difference is location: their leakage is in the subject's data pipeline, ours is in
the instrument. Our case 2 is a leak their taxonomy does not have a slot for, because it assumes
a leak flatters the treatment — ours flattered the *floor arm*, which is worse, since a floor
that beats chance invalidates the metric rather than the arm. The heuristic the floor exploited —
"pick the longest option" — is a shortcut in the sense of Geirhos et al. [3], with the twist that
it was available to a control that was supposed to have nothing to work with.

**Mutation testing.** From software engineering, mutation testing [8] shares our central move: a
suite that cannot fail on a deliberately broken subject is not a suite. Our negative cases are a
hand-built, domain-specific instance — instead of mutating the subject automatically, we
construct one synthetic violation per guard and require it to be caught. We make no claim to
have improved on that literature; we claim that it has not reached agent-memory evaluation,
where the guards are currently shipped unfired.

We claim novelty not in any single insight above but in the observation that an agent-memory
stack reproduces all of these failure modes at once, in a codebase small enough that a single
team can enumerate them and publish the enumeration.

---

## 8. Threats to validity

- **Single project, single team.** The seventeen were found in one codebase over roughly two
  weeks. We claim the taxonomy generalizes; we have not tested that. The most valuable
  falsification would be an independent team applying §4 to their own evaluation apparatus and
  finding either that the classes do not fit, or that they fit everything — which would make
  the taxonomy class F at the level of the paper.
- **Recall bias.** Failures we never noticed cannot appear here. The count is a lower bound,
  and the ones in class E are precisely the ones that hide, so class E is likely undercounted.
- **Evidence provenance is uneven.** Cases 1–7 and 14 are attested by a public repository with
  signed commits. Cases 8–13 are attested by versioned backups produced by the component whose
  behaviour they document — the condition this paper is about. §6 reduces but does not eliminate
  this: the anchors establish that the backups existed by a certain time, not that they were
  honestly produced. A reader should weight cases 8–13 accordingly.
- **Fixes and write-ups share a desk.** Cases 8 and 10 were fixed during the writing of v0.1,
  which makes their write-ups the least neutral: we describe a defect and its remedy in the same
  breath, from the same desk. Case 7's open-book ceiling remains unsolved and is reported as
  such. Case 15 is reported unfixed.
- **The reproduction rate is either evidence or indictment, and we cannot tell which from
  inside.** Seven things reproduced while this paper was being written: a concurrent session
  deleted two log files that six sources cited (case 8's trigger); the first fix for case 8 was
  itself class F; the conformance sandbox broke on a rule its own comment states (case 12); a
  judgment was found asserting a contract that had already changed (case 13); and a judgment
  written for §6 fired on its own rule names, reproducing class F **in the same session in which
  class F was being written up**; the anchoring component of §6 — built specifically to remedy
  the third bullet of this list — shipped attesting to bytes no reader could obtain, and
  explained the discrepancy as normal (case 16); and a session transcript was found sitting in
  every commit of the repository under a policy whose first line forbids it (case 17). We report
  this as evidence for §5. A reader is entitled to read it instead as evidence that the team
  writing the taxonomy is unusually prone to the failures it describes. We cannot distinguish
  those two readings from inside, and we do not claim to. We note only that the last two were
  found by the act of preparing the artifact for someone else to check, which is the cheapest
  instrument in this paper and the one we had not applied until the day we published.

---

## 9. Conclusion

We set out to build an agent-memory system and an apparatus to evaluate it. The apparatus failed
seventeen times, and in every case the failure was invisible to the only component positioned to
see it. The fix that generalizes is not vigilance. It is to require that every component which
can lose, drop, trim, retry, skip or fail emits a count — so that zero becomes a measurement
rather than an absence — and to require that every guard be demonstrated firing, so that an
inert guard is distinguishable from a working one.

We offer the eight classes of §4 as a checklist for anyone building an evaluation apparatus for
an agent system, and the 285 judgments as evidence that the checklist is executable rather than
advisory. We offer the reproduction rate of §8 as the most honest thing in the paper: we wrote
the taxonomy down and then produced two more instances of it while writing.

---

## References

Every entry below was resolved against its publisher or arXiv record on 2026-08-10 rather than
recalled. This is not a flourish: an unresolved citation is class G — a reference that outlives
its referent — and it would be a poor look in this particular paper.

[1] S. R. Bowman and G. E. Dahl. *What Will it Take to Fix Benchmarking in Natural Language
Understanding?* NAACL 2021. arXiv:2104.02145.

[2] P. Chhikara, D. Khant, S. Aryan, T. Singh, and D. Yadav. *Mem0: Building Production-Ready AI
Agents with Scalable Long-Term Memory.* 2025. arXiv:2504.19413.

[3] R. Geirhos, J.-H. Jacobsen, C. Michaelis, R. Zemel, W. Brendel, M. Bethge, and F. A.
Wichmann. *Shortcut Learning in Deep Neural Networks.* Nature Machine Intelligence, 2020.
arXiv:2004.07780.

[4] S. Kapoor and A. Narayanan. *Leakage and the Reproducibility Crisis in ML-based Science.*
2022. arXiv:2207.07048.

[5] N. F. Liu, K. Lin, J. Hewitt, A. Paranjape, M. Bevilacqua, F. Petroni, and P. Liang. *Lost in
the Middle: How Language Models Use Long Contexts.* TACL, 2023. arXiv:2307.03172.

[6] C. Packer, S. Wooders, K. Lin, V. Fang, S. G. Patil, I. Stoica, and J. E. Gonzalez. *MemGPT:
Towards LLMs as Operating Systems.* 2023. arXiv:2310.08560.

[7] I. D. Raji, E. M. Bender, A. Paullada, E. Denton, and A. Hanna. *AI and the Everything in the
Whole Wide World Benchmark.* NeurIPS 2021 Datasets and Benchmarks Track. arXiv:2111.15366.

[8] Y. Jia and M. Harman. *An Analysis and Survey of the Development of Mutation Testing.* IEEE
Transactions on Software Engineering, 37(5):649–678, 2011.

---

## Appendix A — evidence index

Line numbers are 2026-08-10 values in a repository that concurrent sessions write to, and must be
re-pulled at submission. The externally anchored manifests under `governance/anchors/` fix the
file *contents* as of that date independently of this table.

| Case | Primary artifact |
|---|---|
| 1 | `bench/RESULTS-v2.md`; conformance C9 (downgraded) / C10 (created) |
| 2–7 | `bench/RESULTS-v3.md` — results with Wilson intervals, and the section enumerating four experimenter-side bugs; commit `b490d9c` |
| 8 | RFC-0005; `southbridge/benjing-core.mjs` `recheckSource` (form) and `dereferenceSource` (referent); judgments B3.1–B3.4, B12.1–B12.8 |
| 9 | RFC-0006 §0; RFC-0007; `northbridge/compile.mjs` |
| 10 | `demo/task5/task.origin.json` incident fact (reconstructed); `southbridge/benjing-core.mjs:267`; judgments B11.0–B11.5 |
| 11 | `demo/task2/task.origin.json` facts[4] (still `verified: true`); `oob/verify-oob.mjs`; `oob/crosscheck.mjs` |
| 12 | `southbridge/verify-benjing.mjs:56`, three lines below the comment it violated |
| 13 | `southbridge/benjing-core.mjs:267`; judgments B11.3 (repaired) and B11.3b (added) |
| 14 | commit `0015ba1`; the offending artifact remains retrievable in history, deliberately not rewritten |
| 15 | `governance/policy.mjs` `redactOperationalText` applied to `git ls-files`; counts in §3.3 |
| 16 | `governance/anchor.mjs` `gitState` / `reproOf`; judgments A7.1–A7.4; the first snapshot carrying `reproducible_from_git` is `governance/anchors/cacb67f3e4f99631.json` (116/130), and every earlier snapshot in the chain lacks the field — A7.4 failed on them, which is how the gap is visible rather than asserted |
| 17 | `git log --follow` on the stripped path in the pre-publication history; `governance/publish.mjs` (the gate that now scans all reachable objects); the artifact is retained locally and is deliberately absent from the public history |
| §6 | `governance/anchor.mjs`, `governance/verify-anchor.mjs` (19 judgments, 14 negative), `governance/anchors/*.json{,.ots}`; commit `aedfa19` |

## Appendix B — what this paper is not

It is not the claim that structured state beats transcripts. That is a separate, weaker-evidenced
paper (single model, single task, single run, controls written by us, no comparison against
published agent-memory systems). **Do not merge the two.** The value of this paper is that it
does not depend on that one being right.

---

## TODO before submission

- [x] ~~Decide venue~~ — workshop track (2026-08-10 decision). NeurIPS 2026 workshops were
      notified 2026-07-11 and the conference runs Dec 6–13; individual workshop CFP deadlines
      are typically late Sep–Oct. **Pin the specific workshop and its deadline once the accepted
      list is public** — as of 2026-08-10 the NeurIPS virtual site lists none.
- [x] ~~Add real citations to §7~~ — eight references, each resolved against its publisher or
      arXiv record on 2026-08-10 rather than recalled
- [ ] Convert to the venue's LaTeX template and cut to the page limit; §3 tables are the most
      compressible, §4 and §5 are not

### Fallback if no workshop fits (decided 2026-08-10)

Publish the artifact publicly and let the work earn its own endorsement, in this order:

1. **Public GitHub repository** — the paper, the nine conformance suites, and the externally
   anchored evidence manifests. This is the fallback that requires nobody's permission.
2. **Written up for a general audience** (blog / HN / Lobsters). The retraction narrative is the
   hook, not the system.
3. **Then** request arXiv endorsement. Note the mechanism: arXiv issues a private endorsement
   code to be sent to a specific person who can vouch for the work — it is **not** a public
   invitation link, and broadcasting a request is against arXiv's guidance and tends to fail.
   Steps 1–2 exist to make step 3 a request someone can actually say yes to, because they will
   have read the thing.
- [ ] Get a second reader outside the project to try to falsify the taxonomy in §4
- [ ] Re-pull Appendix A line numbers and re-run the §4 judgment counts from a live suite,
      never from this file (176 → 273 → 285 within two days; hardcoding a count is case 9's disease)
- [ ] Confirm the §6 anchors reached Bitcoin block confirmation and replace "pending" with the
      block time, or report that they did not
