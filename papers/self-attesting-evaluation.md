# Self-Attesting Evaluation: Fourteen Ways Our Own Agent-Memory System Lied to Us

**Draft v0.1 — 2026-08-09.** Target: workshop paper (evaluation / agent-memory track) or arXiv preprint.
Status: evidence complete, zero new experiments required. Prose unwritten.

> **中文导读**：这篇的卖点不是「我们做了个好系统」，是「我们的系统骗了我们十四次（写这篇的当天从十一涨到十四，涨的三条见 §4 末节），每一次的证据、修法和撤回记录都在盘上」。
> 主动撤回自己结论的论文，可信度是买不到的。写作成本 1–2 周，0 美元 API。
> 审稿风险是「这是工程日志不是研究」——解法在 §5：把 14 个案例抽象成 8 类判据，
> 并给出「每条判据由哪次真实失败催生」的对照表，日志就升格成方法论。

---

## 1. Claim

Building an agent-memory system means building two things: the system, and the apparatus that says whether the system works. We built both, and the second one failed fourteen times in ways the first one could not detect — because in every case **the component that would have to report the failure was the same component that failed**.

The count was eleven when this draft was started and fourteen by the end of the same day. Three cases (12–14) were found *while writing the paper about the first eleven*, one of them inside the fix for case 8. We report the drift rather than quietly renumbering, because the rate at which a taxonomy keeps finding new instances of itself is evidence about the taxonomy.

We do not present this as a list of bugs. We present it as a structural claim:

> An evaluation that does not publish its own discard count and its own floor is not a weak evaluation. It is an evaluation whose failure mode is indistinguishable from success.

Each of the fourteen has: a reproducible trigger, a fix that shipped, and — for three of them — a public retraction of a conclusion we had already published.

## 2. Why this is publishable rather than a changelog

Three properties, rare in combination:

1. **We retracted our own headline result.** The v0.1 comparison benchmark's conclusion ("a traditional harness cannot resume without asking") was *constructed*, not observed. We found it ourselves, downgraded the conformance item that carried it, and left the retraction in the repository. (§4, case 1)
2. **The failures span two independent subsystems** — the benchmark harness and the persistent-state layer — with the same shape. That rules out "we were sloppy in one file" and argues for a structural cause.
3. **The remedy is executable, not advisory.** It is 176 machine-checked conformance judgments across six specs, and each one is traceable to the failure that motivated it.

## 3. Related work and where we sit

The context/memory-engineering literature (write policy, storage tiering, retrieval strategy, placement, budget) is prescriptive about *reader-side* failure: retrieval without a token budget, and lost-in-the-middle placement. Our fourteen are almost entirely *writer-side* and *world-side*: facts that decayed, renames that did not propagate, concurrent writes that passed the lock, discards that were never declared, checks that verified the form of evidence rather than the evidence.

That asymmetry is itself a finding. **Reader-side defects present immediately as a wrong answer, so they can be reasoned about a priori. Writer-side defects sit quietly on disk for months.** They are found by accident, or by an independent observer, or not at all.

## 4. The fourteen

### Benchmark harness

| # | Failure | Trigger / evidence | Fix shipped |
|---|---|---|---|
| 1 | **Constructed conclusion.** v0.1 compare-bench "proved" a traditional harness cannot resume. The generated transcript never contained `goal` or `next_steps` verbatim, so `tradCanResume` was identically false — and the success criterion was `!tradCanResume`. The test could not fail. | Re-run `genTranscript`: transcript contains goal verbatim = false, contains step verbatim = false ⇒ success ≡ true. `bench/RESULTS-v2.md` §"与 v0.1 的关系" | Conclusion retracted; conformance C9 downgraded to a mechanism unit test; C10 created to carry the evidence |
| 2 | **Leakage: the floor arm scored 3/3.** Not position bias — *length*. The target task had been worked longest, so its fields were longest, and "pick the longest option" won. | v0.2 run: empty-context arm 100% on state-field questions (chance 25%) | Distractors length-matched to the correct answer; correct position rotated A→B→C→D; floor fell to 0%. Automatic check: if the empty-context arm beats chance by >25pp on any n≥8 metric, that metric is printed as **unusable** |
| 3 | **We gagged our own control group.** The summary arm's prompt said "at most N characters"; it wrote 2,735 of a 9,635-character budget. Adding a lower bound made it fill the budget — and its score jumped 26.7% → 60.0%. | `bench/RESULTS-v3.md` §"自己人的 bug" #2 | Control-arm payloads are asserted to be within 30% of the state arm's budget before scoring |
| 4 | **An empty control got cached.** One summary-merge call returned empty content (a reasoning model spent its budget on reasoning tokens). The empty string was written to cache, so every subsequent run silently evaluated a *blank* control while the report still printed "summary arm". | `bench/RESULTS-v3.md` §"自己人的 bug" #3 | Short outputs throw rather than cache; caches are validated on read and deleted when bad |
| 5 | **The scorer counted its own truncation as the subject's error.** Answers cut off at `max_tokens` were scored as wrong. | v0.3 first live run: 16 calls with `finish_reason=length` | Truncated calls re-run at 3× cap; the repair count is printed. *Repairing without saying so is the same disease as truncating without saying so* |
| 6 | **One `ECONNRESET` aborted a 474-call experiment.** A run that dies unevenly biases the record toward the runs that happened to survive. | v0.3 live run, stack trace exit | Exponential backoff on transport errors and 5xx/429; 4xx throws immediately, because retrying an auth error hides it |
| 7 | **A failed probe that looked like a result.** Two-hop questions were added to break the open-book ceiling. All six arms landed within 58.0–71.4%, and the empty-context floor (63.8%) sat 0.5pp from the state arm (64.3%). The probe measures topical similarity — facts and next-steps of one task share vocabulary — not state attribution. | `bench/RESULTS-v3.md`, Wilson 95% intervals overlapping across all six arms, n=23 | Metric retracted in the same report that introduced it; left in the table for transparency, supporting no conclusion |

### Persistent-state layer

| # | Failure | Trigger / evidence | Fix shipped |
|---|---|---|---|
| 8 | **Verification checked the form of evidence, not the evidence.** A fact's `source` was validated for *citing* a rerunnable artifact. Replacing all nine sources in a state file with nonsense still returned VERIFIED. For a further period it still never checked whether the cited artifact resolved: when a concurrent session deleted two log files, six sources went dangling and the checker stayed green. Both times a human found it by accident. | RFC-0005; `southbridge/benjing-core.mjs` `recheckSource` (form) and `dereferenceSource` (referent); judgments B3.1–B3.4, B12.1–B12.8 | Fixed. Dereferencing added: cited paths are resolved through the single observer and reported. **It reports, it does not judge** — a fact whose subject *is* the file's absence must not be flipped to false (locked by B3.3). Six of the eight new judgments are negative cases, because the first implementation produced 26 false alarms out of 32 (see §5, class F) |
| 9 | **The bundle under-reported its own losses.** The context compiler dropped 28 of 96 facts while its header announced a load count. Later: the header/footer were not counted against their own budget, so the bundle overshot and was silently trimmed. | RFC-0006 §0; RFC-0007 | Every drop is now declared in the bundle text ("5/17 facts not expanded"); the reserve is computed from the actual footer length |
| 10 | **The optimistic lock passed a legal but truncated write.** A model read the correct `content_hash`, then submitted a payload containing one fact and an empty `current_state`. The hash matched, so the write was accepted. 11 facts, 2 decisions, 6 learnings and 3 artifacts were destroyed; the file went 5.6K → 1.9K. A later session continued on the wreckage. | `demo/task5` incident record (reconstructed after the fact); judgments B11.0–B11.5 | Fixed. **A hash lock proves freshness, not preservation** — those are different invariants and only the first was implemented. Now: required fields are enforced, and a drop in verified-fact count is denied unless an explicit `__allow_fact_loss` switch is passed (which is itself excluded from the state and from the hash). B11.0 replays the original incident as a standing negative case |
| 11 | **Nothing ever observed the machine.** The boot health check covered credentials (orphans, hashes) and not the environment. A misattributed root cause — "the sandbox read-only policy blocked the write" — survived as `verified: true` for an entire task cycle. The real cause was an approval gate plus a broken sandbox runner. | `demo/task2` facts[4] still `verified:true`; `northbridge/compile.mjs` `health()` covers states/orphans only | Out-of-band probes added (`oob/`, 29 judgments, 24 of them negative cases); `oob/crosscheck.mjs` reconciles claimed state against audit log and against disk |

### Found while writing this paper

| # | Failure | Trigger / evidence | Fix shipped |
|---|---|---|---|
| 12 | **The rule was written down, then applied to two of its three sites.** The conformance sandbox copies component directories wholesale, with a comment saying exactly why: *"enumerating individual files necessarily lags behind dependency growth — the previous three incidents were all a sandbox that missed a newly added cross-component dependency."* Two directories were converted; the third was left enumerating one file. A concurrent session added `southbridge/schema-check.mjs`, the state layer imported it, and the entire 57-judgment suite died with `ERR_MODULE_NOT_FOUND` the same day. **Fourth recurrence of a defect whose remedy was already written in the file.** | `southbridge/verify-benjing.mjs:56`; the comment it violated sits three lines above | Whole-directory copy for `southbridge/*.mjs` |
| 13 | **A judgment asserted a contract that had already changed.** The shrink guard was generalized from "protect `facts`" to "protect five collections", and its denial payload changed from `facts_before`/`facts_after` to a `shrunk[]` array. The judgment kept asserting the old field names. It failed — reading as *the guard is broken* when the guard was fine and the assertion was stale. | `southbridge/benjing-core.mjs:267` (`GUARDED`); judgment B11.3 failing with `undefined→undefined` | Judgment updated to the current contract; B11.3b added, because the generalization to five collections had shipped with no judgment of its own |
| 14 | **A policy was stated in the same commit that violated it, and its enforcement mechanism was inert.** `corpus.json` declared that session transcripts must not enter the public repository; two artifacts derived from those transcripts were committed anyway. Separately, `.gitignore` was a single line containing the literal characters `\n` — so it had never ignored anything since the repository was created. `audit.log` stayed out by luck, not by the guard. | commit `0015ba1` ("The repo stated a policy it had no mechanism to enforce"); `od -c .gitignore` showing `\` and `n` as two characters | Derived artifacts untracked and ignored; `.gitignore` rewritten as real lines. History deliberately **not** rewritten — the content was scanned and carries no personal data, and rewriting public history to hide a disclosed mistake is the opposite of this paper's thesis |

## 5. Taxonomy — from fourteen anecdotes to eight judgment families

The fourteen collapse into eight failure classes. Each class is now a machine-checked judgment family, and this table is the paper's contribution:

| Class | Cases | Judgment that would have caught it |
|---|---|---|
| **A. The check tests the form of the evidence, not the evidence** | 8, 10 | A verification must dereference what it cites, and must compare *before* against *after*, not merely validate the request |
| **B. The measurement's own failure is scored as the subject's failure** | 1, 5 | A test whose success criterion cannot be made false by any behaviour of the subject is void. Instrument failures (truncation, transport, empty payload) must be a third outcome, never "wrong" |
| **C. Nobody measured what happens when there is nothing to find** | 2, 7, 14 | Every metric ships with an empty-context arm; every guard ships with a negative case that fails if the guard does not fire. A floor above chance condemns the metric, not the arm — and a guard that has never fired is indistinguishable from a guard that is inert, which `.gitignore` had been since the repository was created |
| **D. The control was weakened by the experimenter's own plumbing** | 3, 4 | Control-arm payloads are asserted against the treatment's budget before any score is computed |
| **E. Loss is real but never declared** | 6, 9, 11 | Any component that drops, trims, retries or skips must emit the count. Silence is read as full coverage — which is a lie with no author |
| **F. The remedy fires on everything, so it measures nothing** | the first cut of the fix for 8; the first run of the cross-checker (11) | A new checker ships with negative cases that fail if it flags legitimate inputs, and its own first-run false-positive rate is part of its report |
| **G. A reference outlives its referent** | 8's trigger, 13, the renamed benchmark script still cited by a task state's `artifacts[]` | Renaming and contract changes are first-class propagating operations, not edits. The cheap approximation, until that exists, is that every reference is dereferenced by something that runs |
| **H. The rule was written down and applied to a subset of its sites** | 12, and the context bundle that budgeted everything except itself | When a rule is stated, the same change enumerates every site it applies to. A defect that recurs N times is not N instances of carelessness; it is one missing component, and the recurrence count is the measurement of how long we have been paying for it |

Class F deserves emphasis because we produced it *while writing this paper*. The dereference check added for case 8 flagged 32 of 149 verified facts on its first run; 26 were artifacts of its own path-extraction regex (drive letters and `~` sliced off, sibling-repository relative paths declared missing because their base was never resolvable). Shipped as-is it would have made the health indicator permanently red, which is indistinguishable from having no indicator. The rule that survived is narrower and derived from the existing evidence taxonomy rather than from keywords: **a vanished path matters only when the path is the sole rerunnable item in that source.** All six remaining dangling references cite a command as well, so the evidence is still reachable and the warning stays quiet — and therefore still means something when it fires.

Across six specs we run 176 such judgments (state 57, action 43, out-of-band 29, context 19, world-observation 14, todo-propagation 14); 8 of the 57 were added by this paper's own case 8, 6 of them negative. **Each was written after a failure, not before.** We consider that provenance to be the interesting data, not an embarrassment: it records which invariants are discoverable only by being violated.

## 6. The generalizable claim

Every one of the fourteen has the same shape: **a component was asked to report on a failure that only it could see, and it was not required to.** The fix is never "be more careful". It is to make the loss a first-class output — a number that appears whether or not anything was lost, so that zero is a measurement rather than an absence.

Stated as a design rule:

> Anything that can discard must publish its discard count.
> Anything that can measure must publish its floor.
> Anything that verifies must dereference.
> Anything that guards must be shown firing.
> Anything that is referenced must learn when its referent changes.
> Any rule worth writing in a comment is worth applying to every site in the same change.

The corollary is uncomfortable and, we think, correct: **a system that reports "no problems" without reporting how it looked is indistinguishable from one that did not look.**

Two of these six are not about detection at all, and they are the ones we keep re-learning. A rename is not an edit — it is an event that other things depend on, and nothing in an ordinary toolchain tells the dependents (class G). A rule stated once and applied twice out of three times is not 2/3 fixed; it is a defect with a longer fuse (class H). Both are cases where the honest instrument exists and still loses, because **the information needed to act was in a different place from the action**.

## 7. Threats to validity

- Single project, single team. The fourteen were found in one codebase over roughly two weeks. We claim the taxonomy generalizes; we have not tested that.
- Recall bias: failures we never noticed cannot appear here. The count is a lower bound, and the ones in class E are precisely the ones that hide, so class E is likely undercounted.
- **Half the evidence is not under version control.** The state layer's repository has no git history; its record is the versioned backup written on each accepted write. That record is produced by the same component whose behaviour it documents — which is, precisely, this paper's subject. A reader should treat cases 8–13 as attested by artifacts we control, and weight cases 1–7 and 14 (public repository, signed commits) accordingly.
- Cases 8 and 10 were fixed during the writing of this paper, which makes their write-ups the least neutral: we describe a defect and its remedy in the same breath, from the same desk. Case 7's open-book ceiling remains unsolved and is reported as such.
- Four things reproduced *while this paper was being written*: a concurrent session deleted the two log files that six sources cited (case 8's trigger); the first implementation of the fix for case 8 was itself class F; the conformance sandbox broke on a rule its own comment states (case 12); and a judgment was found asserting a contract that had already changed (case 13). We report this as evidence for §6 rather than as coincidence — but a reader is entitled to read it instead as evidence that the team writing the taxonomy is unusually prone to the failures it describes. We cannot distinguish those two readings from inside, and we do not claim to.

---

## Appendix A — evidence index

Two repositories. `2origin-harness` is public and under git, so its evidence carries commit SHAs. **The ShadowOS working repository is not under git** — its history lives in `demo/.benjing-backups/<epoch>-<task>-v<n>.json`, one file per accepted write, produced by the state layer's own optimistic-lock path. That is a real limitation of this evidence base and is restated in §7; line numbers below are as of 2026-08-09 and must be re-pulled at submission.

| Case | Primary artifact |
|---|---|
| 1 | `2origin-harness/bench/RESULTS-v2.md` §"与 v0.1 的关系"; conformance C9 (downgraded) / C10 (created) |
| 2, 3, 4, 5, 6, 7 | `2origin-harness/bench/RESULTS-v3.md` — §结果 (Wilson intervals), §"这一轮抓出来的四个自己人的 bug"; commit `b490d9c`, README front page `7931f50` |
| 8 | RFC-0005; `southbridge/benjing-core.mjs:428` (`recheckSource`, form only — its own comment states the scope) and `:469` (`dereferenceSource`, referent); judgments B3.1–B3.4, B12.1–B12.8 |
| 9 | RFC-0006 §0; RFC-0007; `northbridge/compile.mjs` (`healthLine`, and the header that now degrades with the body) |
| 10 | `demo/task5/task.origin.json` incident fact (reconstructed); `southbridge/benjing-core.mjs:267` (`GUARDED`); judgments B11.0–B11.5 |
| 11 | `demo/task2/task.origin.json` facts[4] (still `verified: true`); `oob/verify-oob.mjs` (29 judgments, 24 negative); `oob/crosscheck.mjs` |
| 12 | `southbridge/verify-benjing.mjs:56`, three lines below the comment it violated (`:48–49`) |
| 13 | `southbridge/benjing-core.mjs:267`; judgments B11.3 (repaired) and B11.3b (added) |
| 14 | `2origin-harness` commit `0015ba1` — "The repo stated a policy it had no mechanism to enforce"; the offending artifact remains retrievable at `0831752:bench/cache/summary-task6-9634.txt`, history deliberately not rewritten |

## Appendix B — what this paper is not

It is not the claim that structured state beats transcripts. That is a separate, weaker-evidenced paper (single model, single task, single run, controls written by us, no comparison against mem0 / Letta / LangMem / Zep). Its current honest scope is published in `2origin-harness/README.md`. **Do not merge the two.** The value of this paper is that it does not depend on that one being right.

---

## TODO before submission

- [ ] Decide venue: NeurIPS/ICLR workshop on agents & memory, an evaluation-methods workshop, or arXiv-first
- [x] ~~English terminology map, and resolve the 影核 vs 南桥 overlap~~ — `TERMINOLOGY.md`. Resolved *from the code*, because the architecture document contradicts itself (ch.4 heading makes 影核 ⊃ 南桥; the 南桥 section makes 影核 the driver 南桥 calls). Verdict: **影核 = action kernel** (decides and acts, one implementation), **南桥 = action channel** (carries the request; parity across channels is verified, not assumed). Second collision found and fixed: `credential` was being used for both the task state and the `trust.credential` authorization token — now reserved for the latter
- [x] ~~Pull exact commit SHAs and line numbers for every row of Appendix A~~ — done, with the caveat that the ShadowOS side has no git and its line numbers are dated
- [ ] Write the prose. §1–§7 are argued but skeletal; the tables carry the load and will not survive review on their own
- [ ] Re-pull Appendix A line numbers immediately before submission (they are 2026-08-09 values in a repository three sessions are writing to concurrently)
- [ ] Get a second reader outside the project to try to falsify the taxonomy in §5
- [x] ~~Decide whether cases 8 and 10 get fixed before submission~~ — both fixed (B11.0–B11.5, B12.1–B12.8). Case 7's open-book ceiling stays open
- [ ] Recount §5's judgment totals at submission time from a live run, never from this file (the count went 148 → 176 in one afternoon, and hardcoding a count is case 9's disease)
