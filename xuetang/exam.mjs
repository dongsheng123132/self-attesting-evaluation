#!/usr/bin/env node
// exam.mjs — 学堂 v0.1 的长循环考试
//
// 这是「一次成功不是永久真理」从口号变成机制的地方：每条 verified 经验都挂着一个
// 可重跑的动作，考试就是把它们**再跑一遍**。跑挂了当场降级，不问它当初多有道理。
//
// 三条它自己必须守住的规矩（都来自本仓库付过学费的缺陷）：
//   1. 跑不起来 ≠ 跑挂了。命令找不到、超时、抛异常记 error，不升不降——
//      把 error 当 fail 会让「环境坏了」冒充「经验错了」，那是新的自证来源。
//   2. 落盘一律走本境 putState 的乐观锁。学堂自己开一条写路径，就是 task5
//      那次学历被吃掉的复刻。
//   3. 一条都没跑也要如实说。「0 条经验」必须打印成 0 条，不能因为循环没进去
//      就默认打出一个「全部通过」——那是 bundle 谎报装载量的同型。
//
// 用法：
//   node xuetang/exam.mjs            # 跑一轮考试并写回
//   node xuetang/exam.mjs --dry-run  # 只跑不写
//   node xuetang/exam.mjs --json     # 机器可读
// 退出码：0 = 全部通过（或无经验可考）　1 = 有降级/失败/错误，需要人看　2 = 写回失败

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findStates, readState, putState, contentHash } from '../southbridge/benjing-core.mjs';
import { SPEC, checkRecheck, applyExam, learningId, normalizeForWrite, discriminating } from './learning-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const has = k => process.argv.includes(k);
const DRY = has('--dry-run');
const JSONOUT = has('--json');
const TIMEOUT = 180000;

const now = new Date().toISOString();
const log = (...a) => { if (!JSONOUT) console.log(...a); };

// ── 收集：经验挂在各自的学历里（它们从那个任务里长出来），考试跨学历统一跑 ──
const files = findStates(ROOT);
const items = [];      // {file, rel, idx, l}
for (const f of files) {
  let s;
  try { s = readState(f).state; } catch { continue; }
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  (s.learnings || []).forEach((l, idx) => items.push({ file: f, rel, idx, l }));
}

log(`═══ 学堂长循环考试 · ${SPEC} ═══`);
log(`扫到 ${files.length} 份学历，${items.length} 条经验\n`);

if (!items.length) {
  // 一条都没有也要如实说，不能默认打「全部通过」
  log('（0 条经验：学堂还没有可考的东西。这不是通过，是空。）');
  if (JSONOUT) console.log(JSON.stringify({ spec: SPEC, when: now, learnings: 0, results: [] }, null, 2));
  process.exit(0);
}

// ── 逐条开考 ──
const results = [];
for (const it of items) {
  const id = it.l.id || learningId(it.l.lesson);
  const rc = checkRecheck(it.l.recheck);
  if (!rc.ok) {
    // 无可重跑检验：不算 error（它没坏），算「不可考」。verified 的必须被压回去。
    results.push({ ...it, id, result: 'unexaminable', detail: rc.reason });
    log(`  ○ 不可考  ${id}  ${rc.reason}`);
    continue;
  }
  const t0 = Date.now();
  let r;
  try {
    r = spawnSync(rc.argv[0], rc.argv.slice(1), { cwd: ROOT, timeout: TIMEOUT, encoding: 'utf8', shell: false });
  } catch (e) {
    r = { error: e };
  }
  const ms = Date.now() - t0;
  let result, detail;
  if (r.error) {
    result = 'error'; detail = `跑不起来：${r.error.message || r.error}`;
  } else if (r.signal) {
    result = 'error'; detail = `被信号中止 ${r.signal}（可能是超时 ${TIMEOUT}ms）`;
  } else {
    const wantExit = it.l.recheck.expect_exit == null ? 0 : it.l.recheck.expect_exit;
    const wantOut = it.l.recheck.expect_stdout || '';
    const out = (r.stdout || '') + (r.stderr || '');
    const exitOk = r.status === wantExit;
    const outOk = !wantOut || out.includes(wantOut);
    result = (exitOk && outOk) ? 'pass' : 'fail';
    detail = exitOk
      ? (outOk ? `退出码 ${r.status}` : `退出码对，但输出里找不到 ${JSON.stringify(wantOut)}`)
      : `退出码 ${r.status}，期望 ${wantExit}`;
  }
  results.push({ ...it, id, result, detail, ms });
  const mark = { pass: '✔ 通过', fail: '✗ 挂了', error: '⚠ 跑不起来' }[result];
  log(`  ${mark}  ${id}  ${detail}　(${(ms / 1000).toFixed(1)}s)  ${String(it.l.lesson).slice(0, 46)}`);
}

// ── 结算：算出每份学历的新 learnings，走乐观锁写回 ──
const byFile = new Map();
for (const r of results) {
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file).push(r);
}

const changes = [];
let writeFailed = 0;
for (const [file, rs] of byFile) {
  const cur = readState(file);
  const next = JSON.parse(JSON.stringify(cur.state));
  let touched = false;
  for (const r of rs) {
    const before = next.learnings[r.idx];
    let after;
    if (r.result === 'unexaminable') {
      // R1/R2：不可考的经验不许挂着 verified
      if (before.status === 'verified') {
        after = { ...before, status: 'candidate',
                  exam: { ...(before.exam || {}), last_run: now, last_result: 'unexaminable',
                          last_detail: r.detail.slice(0, 300), demoted_at: now, demoted_by: 'exam' } };
      } else { after = before; }
    } else {
      after = applyExam(before, r.result, { when: now, detail: r.detail });
    }
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      if (before.status !== after.status)
        changes.push({ id: r.id, from: before.status, to: after.status, why: r.detail, lesson: before.lesson });
      next.learnings[r.idx] = after;
      touched = true;
    }
  }
  if (!touched || DRY) continue;
  next.updated_at = now;
  const res = putState(file, next, { expect: contentHash(cur.state), actor: 'xuetang/exam' });
  if (res.status !== 'done') {
    writeFailed++;
    console.error(`✗ 写回 ${path.relative(ROOT, file)} 失败：${res.status} ${res.reason || ''}`);
    if (res.status === 'diverged') console.error('  （有别的会话同时在改这份学历，重跑一次考试即可，别硬写）');
  }
}

// ── 报告 ──
const n = k => results.filter(r => r.result === k).length;
log('');
log(`结算：通过 ${n('pass')}　挂了 ${n('fail')}　跑不起来 ${n('error')}　不可考 ${n('unexaminable')}　共 ${results.length} 条`);
if (changes.length) {
  log('\n状态变更：');
  for (const c of changes) log(`  ${c.from} → ${c.to}　${c.id}　${String(c.lesson).slice(0, 52)}\n      因为：${c.why}`);
} else log('无状态变更');
// 判别力：一条考题只有被观察到红过，才算证明了它分得开好坏。
// 不报这个数，「6 条经验通过考试」会被读成「6 条经验被证明为真」——而其中可能
// 有恒绿考题。不报告未证明量，等于谎报证明强度（与判分器不报截断量同型）。
const examined = results.filter(r => r.result !== 'unexaminable');
const unproven = examined.filter(r => discriminating(r.l) === 'unproven');
log('');
log(`判别力：${examined.length - unproven.length}/${examined.length} 条考题曾被观察到红过（证明它分得开好坏）`);
if (unproven.length) {
  log(`⚠ ${unproven.length} 条考题从未红过，判别力**未证明**——恒绿考题与真考题在账面上长得一样：`);
  for (const r of unproven) log(`    ${r.id}  ${r.l.recheck.run}　${String(r.l.lesson).slice(0, 38)}`);
}
if (DRY) log('\n(--dry-run：以上变更未写回)');

if (JSONOUT) {
  console.log(JSON.stringify({
    spec: SPEC, when: now, states: files.length, learnings: results.length,
    pass: n('pass'), fail: n('fail'), error: n('error'), unexaminable: n('unexaminable'),
    discriminating_proven: examined.length - unproven.length, discriminating_unproven: unproven.length,
    changes, write_failed: writeFailed,
    results: results.map(r => ({ id: r.id, from: r.rel, result: r.result, detail: r.detail, ms: r.ms }))
  }, null, 2));
}

if (writeFailed) process.exit(2);
process.exit(n('fail') + n('error') + n('unexaminable') > 0 ? 1 : 0);
