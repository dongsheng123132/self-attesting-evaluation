#!/usr/bin/env node
// verify-xuetang.mjs — 学堂 v0.1 一致性验证
//
// 判据以**反向用例**为主：正向只能测「实现有没有跑」，测不出「判据成不成立」。
// 学堂尤其需要反向判据，因为它管的是「谁有资格说自己学会了」——
// 一个只会点头的考试机构，比没有考试机构更坏：它给不合格的经验发了证。
//
// 用法：node xuetang/verify-xuetang.mjs
// 退出码：0 = 全过　1 = 有失败

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SPEC, learningId, checkRecheck, checkLearning, normalizeForWrite, applyExam, collect, ALLOWED_CMDS, EXECUTION_DENIED, discriminating
} from './learning-core.mjs';
import { checkState } from '../southbridge/schema-check.mjs';
import { putState, contentHash, readState } from '../southbridge/benjing-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const results = [];
// 判据登记后统一顺序执行：v0.1 第一版这里没 await，异步判据返回 Promise，
// 被 `r === true` 判成失败，报出来是 "[object Promise]"。
// 判据框架自己就是「声明冒充事实」的高发区——它说"这条挂了"，其实是它没读懂结果。
const cases = [];
const t = (id, name, fn) => cases.push({ id, name, fn });
async function runAll() {
  for (const c of cases) {
    let ok, detail = '';
    try {
      const r = await c.fn();
      ok = r === true;
      if (r !== true) detail = typeof r === 'object' ? JSON.stringify(r) : String(r);
    } catch (e) { ok = false; detail = 'EXCEPTION: ' + (e.message || e); }
    results.push({ ...c, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${c.id.padEnd(6)} ${c.name}${ok ? '' : `\n        ${detail}`}`);
  }
}

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'xuetang-'));
const mkState = (id, extra = {}) => ({
  spec: '2origin/0.2', kind: 'task.origin', id, title: id, goal: 'g', version: 1,
  current_state: 'cs', updated_at: '2026-08-09T00:00:00+08:00',
  facts: [], decisions: [], actions: [], artifacts: [],
  next_steps: [], learnings: [], ...extra
});
const L = (o = {}) => ({ lesson: '一条足够长的经验主张，用来测形状', status: 'candidate', ...o });
const RC = { kind: 'command', run: 'node --version', expect_exit: 0 };

console.log(`═══ 学堂一致性验证（${SPEC}）═══\n`);

// ───────── R1：没有可重跑检验的经验，最高只能 candidate ─────────
t('X1.1', '【反向】verified 但没有 recheck → checkLearning 判不合格', () => {
  const r = checkLearning(L({ status: 'verified' }));
  return (!r.ok && r.issues.some(i => /verified 但无可重跑检验/.test(i))) || JSON.stringify(r.issues);
});
t('X1.2', '【反向】recheck 首词不在白名单 → 不算可重跑（防把任意程序当考题）', () => {
  const r = checkRecheck({ kind: 'command', run: 'rm -rf /' });
  return (!r.ok && /白名单/.test(r.reason)) || `ok=${r.ok} ${r.reason}`;
});
t('X1.3', '【反向】recheck.run 含管道/重定向/换行 → 拒绝（考试跑命令不跑脚本）', () => {
  const bad = ['node a.mjs | grep x', 'node a.mjs > out.txt', 'node a.mjs && node b.mjs', 'node a.mjs\nrm x'];
  const rs = bad.map(run => checkRecheck({ kind: 'command', run }));
  return rs.every(r => !r.ok) || `有漏网: ${JSON.stringify(rs.map(r => r.ok))}`;
});
t('X1.4', '【反向】recheck.kind 不是 command → 拒绝（v0.1 不许静默支持没实现的形态）', () => {
  const r = checkRecheck({ kind: 'human-review', run: 'node a.mjs' });
  return (!r.ok && /只认 command/.test(r.reason)) || r.reason;
});
t('X1.5', '正向：合法 recheck 通过并解析出 argv（不走 shell）', () => {
  const r = checkRecheck(RC);
  return (r.ok && r.argv[0] === 'node' && r.argv.length === 2) || JSON.stringify(r);
});

// ───────── R2：升级只能由考试给，作者不能自己发证 ─────────
t('X2.1', '【反向】作者自写 verified 且无考试记录 → normalizeForWrite 压回 candidate', () => {
  const { learnings, demoted } = normalizeForWrite([L({ status: 'verified', recheck: RC })]);
  return (learnings[0].status === 'candidate' && demoted.length === 1 && /升级只能由考试给/.test(demoted[0].why))
    || JSON.stringify({ s: learnings[0].status, demoted });
});
t('X2.2', '【反向】伪造 exam 但 last_result 不是 pass → 仍压回 candidate', () => {
  const { learnings } = normalizeForWrite([L({ status: 'verified', recheck: RC, exam: { runs: 3, last_result: 'fail' } })]);
  return learnings[0].status === 'candidate' || learnings[0].status;
});
t('X2.3', '正向：有考试通过记录 + 可跑 recheck 的 verified 予以保留', () => {
  const { learnings, demoted } = normalizeForWrite([L({ status: 'verified', recheck: RC, exam: { runs: 1, last_result: 'pass' } })]);
  return (learnings[0].status === 'verified' && demoted.length === 0) || JSON.stringify({ s: learnings[0].status, demoted });
});
t('X2.4', 'normalizeForWrite 必须补 id，且同一 lesson 得到同一 id（跨学历可对账）', () => {
  const a = normalizeForWrite([L()]).learnings[0];
  const b = normalizeForWrite([L()]).learnings[0];
  return (a.id && a.id === b.id && a.id === learningId(a.lesson)) || `${a.id} vs ${b.id}`;
});

// ───────── R3：一次成功不是永久真理 ─────────
t('X3.1', '正向：pass 把 candidate 升为 verified 并记 promoted_at', () => {
  const n = applyExam(L({ recheck: RC }), 'pass', { when: 'T' });
  return (n.status === 'verified' && n.exam.passes === 1 && n.exam.promoted_at === 'T') || JSON.stringify(n);
});
t('X3.2', '【反向】fail 把 verified 当场降回 candidate 并记明是考试降的', () => {
  const n = applyExam(L({ status: 'verified', recheck: RC, exam: { runs: 1, passes: 1, last_result: 'pass' } }), 'fail', { when: 'T2' });
  return (n.status === 'candidate' && n.exam.demoted_by === 'exam' && n.exam.fails === 1) || JSON.stringify(n.exam);
});
t('X3.3', '【反向】error 不升也不降——跑不起来 ≠ 经验错了，也 ≠ 经验对了', () => {
  const a = applyExam(L({ status: 'verified', recheck: RC }), 'error', { when: 'T' });
  const b = applyExam(L({ status: 'candidate', recheck: RC }), 'error', { when: 'T' });
  return (a.status === 'verified' && b.status === 'candidate' && a.exam.errors === 1)
    || `a=${a.status} b=${b.status} errors=${a.exam.errors}`;
});
t('X3.4', '【反向】考试次数只增不减（runs 是账，不是状态）', () => {
  let n = L({ recheck: RC });
  for (const r of ['pass', 'fail', 'error', 'pass']) n = applyExam(n, r, { when: 'T' });
  return n.exam.runs === 4 || `runs=${n.exam.runs}`;
});

// ───────── schema 承重：verified 必须带 recheck+exam ─────────
t('X4.1', '【反向】schema 拦住「verified 却没有 recheck/exam」的学历', () => {
  const p = path.join(SB, 'bad.json');
  const s = mkState('bad', { learnings: [L({ status: 'verified' })] });
  fs.writeFileSync(p, JSON.stringify(s));
  const probs = checkState(s);
  return probs.some(x => /learnings\[0\]\.recheck/.test(x.at)) || `schema 放行了: ${JSON.stringify(probs)}`;
});
t('X4.2', '正向：candidate 不要求 recheck（经验可以先记下来，只是不许自称已验证）', () => {
  const probs = checkState(mkState('ok', { learnings: [L()] }));
  return probs.length === 0 || JSON.stringify(probs);
});

// ───────── R5：只有 verified 进上下文 ─────────
t('X5.1', '【反向】北桥 request 不许注入 candidate 经验', async () => {
  const { compileRequest } = await import('../northbridge/compile.mjs');
  const d = path.join(SB, 'nb'); fs.mkdirSync(path.join(d, 'demo/t1'), { recursive: true });
  fs.writeFileSync(path.join(d, 'demo/t1/task.origin.json'), JSON.stringify(mkState('t1', {
    learnings: [L({ lesson: '乐观锁只回答你读的是不是最新的，回答不了你有没有把内容带上', status: 'candidate', recheck: RC })]
  })));
  const r = compileRequest(d, '乐观锁 并发 学历');
  return (r.learnings.length === 0 && !/经验·已通过考试/.test(r.text)) || `注入了 ${r.learnings.length} 条 candidate`;
});
t('X5.2', '正向：verified 经验会被按目标调入，且标明它靠哪条命令过的考试', async () => {
  const { compileRequest } = await import('../northbridge/compile.mjs');
  const d = path.join(SB, 'nb2'); fs.mkdirSync(path.join(d, 'demo/t1'), { recursive: true });
  fs.writeFileSync(path.join(d, 'demo/t1/task.origin.json'), JSON.stringify(mkState('t1', {
    learnings: [L({ lesson: '乐观锁只回答你读的是不是最新的，回答不了你有没有把内容带上', status: 'verified', recheck: RC, exam: { runs: 1, last_result: 'pass' } })]
  })));
  const r = compileRequest(d, '乐观锁 并发 学历');
  return (r.learnings.length === 1 && /node --version/.test(r.text)) || `picked=${r.learnings.length}`;
});

// ───────── 考试器自身不许成为新的自证来源 ─────────
t('X6.1', '【反向】exam 不许自己开写路径：源码里不得出现 writeFileSync', () => {
  const src = fs.readFileSync(path.join(here, 'exam.mjs'), 'utf8');
  return !/writeFileSync/.test(src) || '学堂自己写盘就绕过了本境乐观锁——task5 那次学历被吃掉的复刻';
});
t('X6.2', 'exam 落盘必须经 putState 且带 expect（源码级判据）', () => {
  const src = fs.readFileSync(path.join(here, 'exam.mjs'), 'utf8');
  return (/putState\(/.test(src) && /expect:\s*contentHash\(/.test(src)) || '没看到 putState(..., {expect: contentHash(...)})';
});
t('X6.3', '【反向】expect 过期时写回必须 diverged 且磁盘不变（真跑一次，不是读源码）', () => {
  const p = path.join(SB, 'lock.json');
  const s = mkState('lock', { learnings: [L()] });
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
  const before = fs.readFileSync(p, 'utf8');
  const r = putState(p, { ...s, learnings: [L({ lesson: '被别人抢先改过的版本' })] }, { expect: 'deadbeef'.repeat(8) });
  return (r.status === 'diverged' && fs.readFileSync(p, 'utf8') === before) || `${r.status} / 磁盘${fs.readFileSync(p, 'utf8') === before ? '未变' : '变了'}`;
});
t('X6.4', '【反向】0 条经验时不许当作「全部通过」——空必须报成空', () => {
  const src = fs.readFileSync(path.join(here, 'exam.mjs'), 'utf8');
  return /这不是通过，是空/.test(src) || 'exam 没有对「0 条经验」单独发声，会被读成全部通过';
});

// ───────── 聚合与去重 ─────────
t('X7.1', 'collect 跨学历按 id 去重，保留考试记录更全的那份', () => {
  const a = { rel: 'demo/a/task.origin.json', s: { learnings: [L({ exam: { runs: 1 } })] } };
  const b = { rel: 'demo/b/task.origin.json', s: { learnings: [L({ exam: { runs: 5 } })] } };
  const c = collect([a, b]);
  return (c.length === 1 && c[0].l.exam.runs === 5) || JSON.stringify(c.map(x => x.l.exam));
});
t('X7.2', '【反向】lesson 过短/为空必须被判不合格（写不下一条能被推翻的主张）', () => {
  const r1 = checkLearning({ lesson: 'l1', status: 'candidate' });
  const r2 = checkLearning({ lesson: '', status: 'candidate' });
  return (!r1.ok && !r2.ok) || `r1=${r1.ok} r2=${r2.ok}`;
});
// 从本境源码里取它认可的命令词，不在这里再抄一份——抄一份就有两个真相
function benjingCmds() {
  const core = fs.readFileSync(path.join(ROOT, 'southbridge/benjing-core.mjs'), 'utf8');
  const m = core.match(/const cmdRe = [^\n]*\\b\(([^)]+)\)/);
  if (!m) throw new Error('benjing-core 里找不到 cmdRe，判据失去基准');
  return m[1].split('|');
}
// v0.1 第一版这条写的是「两边命令词必须相同」，跑出来红了（本境有 rm/touch）。
// 但那个差异是**对的**：本境只是认出一句话里提到了命令（从不执行），学堂是反复
// 自动执行。判据要求相同，是把表面一致当成了不变量。真正的不变量有三条：
t('X7.3', '学堂白名单必须是本境的子集：学堂能跑的，本境必须也认得（多出来的就是没人审过的执行权）', () => {
  const extra = ALLOWED_CMDS.filter(x => !benjingCmds().includes(x));
  return extra.length === 0 || `学堂能执行但本境不认: ${JSON.stringify(extra)}`;
});
t('X7.4', '【反向】本境认、学堂不认的每一个命令都必须在 EXECUTION_DENIED 里写明理由（差集是决定，不是疏漏）', () => {
  const undoc = benjingCmds().filter(x => !ALLOWED_CMDS.includes(x)).filter(x => !EXECUTION_DENIED[x]);
  return undoc.length === 0 || `被排除却没写理由: ${JSON.stringify(undoc)}`;
});
t('X7.5', '【反向】被拒的破坏性命令确实过不了 checkRecheck（写了理由不等于真拦住）', () => {
  const leaked = Object.keys(EXECUTION_DENIED).filter(c => checkRecheck({ kind: 'command', run: `${c} x` }).ok);
  return leaked.length === 0 || `写了理由却仍能当考题: ${JSON.stringify(leaked)}`;
});

// ───────── 考题的判别力（RFC-0008 §6 那个最大的洞的可测量部分）─────────
t('X8.1', '判别力只认考试账本（fails>0），不认任何自称字段', () => {
  const proven = discriminating(L({ exam: { runs: 2, passes: 1, fails: 1 } }));
  const faked = discriminating(L({ discriminating: 'proven', proven: true, exam: { runs: 9, passes: 9, fails: 0 } }));
  return (proven === 'proven' && faked === 'unproven') || `proven=${proven} faked=${faked}`;
});
t('X8.2', '【反向】恒绿考题不许被判成有判别力——跑 9 次全绿仍是 unproven', () => {
  return discriminating(L({ recheck: RC, exam: { runs: 9, passes: 9, fails: 0 } })) === 'unproven'
    || '恒绿考题被判成 proven，那正是「挂 node --version 骗过考试」这个洞';
});
t('X8.3', '【反向】exam 必须把「判别力未证明」的条数打出来（不报未证明量 = 谎报证明强度）', () => {
  const src = fs.readFileSync(path.join(here, 'exam.mjs'), 'utf8');
  return (/discriminating_unproven/.test(src) && /判别力未证明|判别力\*\*未证明\*\*/.test(src))
    || 'exam 没有单独报告未证明量，「N 条通过考试」会被读成「N 条被证明为真」';
});

// ───────── 报告 ─────────
(async () => {
  await runAll();
  fs.rmSync(SB, { recursive: true, force: true });
  const pass = results.filter(r => r.ok).length;
  const rev = results.filter(r => /【反向】/.test(r.name)).length;
  console.log(`\n═══ 学堂 v0.1 一致性验证（${SPEC}）═══`);
  console.log(`判决: ${pass === results.length ? '✅ VERIFIED' : '❌ NOT VERIFIED'}（${results.length} 条判据，其中 ${rev} 条是反向用例：故意造假必须被抓住）`);
  console.log(`通过 ${pass} / ${results.length}`);
  if (pass !== results.length) {
    console.log('\n失败:');
    for (const r of results.filter(x => !x.ok)) console.log(`  • ${r.id} ${r.name}\n    ${r.detail}`);
  }
  process.exit(pass === results.length ? 0 : 1);
})();
