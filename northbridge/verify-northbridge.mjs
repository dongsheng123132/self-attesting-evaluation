#!/usr/bin/env node
// verify-northbridge.mjs — 本源北桥 v0.2 一致性验证器
//
// 规矩同另外三个验证器：判据只取自磁盘真相与进程退出码，沙箱在临时目录，可重复跑。
//
// 这批判据里最重要的是 N3.1 —— 它锁的是**跨三个版本都成立的那条不变量**：
//   「磁盘上的已验证事实，不会因为预算而永久不可见。」
// v0.1 用「抓最新一份」实现（违反了）、v0.2 用「全塞+轮转」实现（仍丢 28 条）、
// v0.3 用「boot 列目录 + 按需调入」实现。实现换了三次，判据不该跟着换。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileBoot, compileRequest, relevance, factId, SPEC } from './compile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const SB = path.join(os.tmpdir(), `nb-verify-${process.pid}-${Date.now()}`);

const results = [];
const t = (id, desc, fn) => {
  try { const r = fn(); results.push({ id, desc, ok: r === true, detail: r === true ? '' : String(r) }); }
  catch (e) { results.push({ id, desc, ok: false, detail: 'EXCEPTION: ' + e.message }); }
};
const J = (...p) => path.join(SB, ...p);
const writeJ = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8'); };

// ── 沙箱：12 份学历，每份 8 条事实，主题各不相同，足以撑爆任何固定预算 ──
const TOPICS = ['幂等账本', '只读闸门', '模型观测', '孤儿检测', '轮转分配', '原子替换写',
  '沙箱运行器', '乐观锁凭据', '预算核算', '证据可复核', '并发丢失更新', '学历沉底'];
const ALL_FACTS = [];
fs.mkdirSync(SB, { recursive: true });
TOPICS.forEach((topic, i) => {
  const facts = [];
  for (let k = 0; k < 8; k++) {
    const claim = `${topic}相关的第${k}条已验证事实：这里描述${topic}在实测中暴露出来的具体行为`;
    facts.push({ claim, verified: true, source: `node verify-${i}.mjs 判据 N${i}.${k}` });
    ALL_FACTS.push({ claim, topic, task: `t${i}` });
  }
  writeJ(J(`demo/t${i}/task.origin.json`), {
    spec: '2origin/0.2', kind: 'task.origin', id: `t${i}`, title: `任务 ${topic}`,
    goal: `把${topic}搞清楚`, version: 1, updated_at: '2026-08-01T00:00:00Z',
    current_state: `${topic} 的当前状态`, next_steps: [`继续 ${topic}`], facts
  });
  fs.utimesSync(J(`demo/t${i}/task.origin.json`), new Date(2026, 0, i + 1), new Date(2026, 0, i + 1));
});
const ACTIVE = 't11'; // mtime 最新的那份

// ───────────── N1 boot：不猜相关性，但一份学历都不许漏 ─────────────
const boot = compileBoot(SB);

t('N1.1', 'boot 把磁盘上每一份学历都列出来（正文可以不装，存在性不许漏）', () => {
  const missing = TOPICS.map((_, i) => `demo/t${i}/task.origin.json`).filter(p => !boot.text.includes(p));
  return missing.length === 0 || `这些学历在 boot 里查无此人: ${missing.join(', ')}`;
});
t('N1.2', 'boot 不超预算且不触发静默硬截断', () =>
  (boot.text.length <= 6000 && !boot.text.includes('⚠⚠')) || `长度 ${boot.text.length}，硬截断=${boot.text.includes('⚠⚠')}`);
t('N1.3', 'boot 声明的「N 份 / M 条」与磁盘实际相符（不谎报）', () => {
  const m = boot.text.match(/磁盘上 (\d+) 份学历、(\d+) 条已验证事实/);
  if (!m) return 'boot 头部没有计数声明';
  return (Number(m[1]) === TOPICS.length && Number(m[2]) === ALL_FACTS.length)
    || `声明 ${m[1]}份/${m[2]}条，实为 ${TOPICS.length}份/${ALL_FACTS.length}条`;
});
t('N1.4', 'boot 把当前任务的事实全量装载（这一份是确定需要的，不需要猜）', () => {
  const mine = ALL_FACTS.filter(f => f.task === ACTIVE);
  const missing = mine.filter(f => !boot.text.includes(f.claim));
  return missing.length === 0 || `当前任务有 ${missing.length}/${mine.length} 条没进 boot`;
});
t('N1.5', 'boot 是确定性的：同样的磁盘状态跑两次，输出逐字节相同（它不该有任何猜测成分）', () => {
  const a = compileBoot(SB).text, b = compileBoot(SB).text;
  return a === b || 'boot 两次输出不一致——说明里面混进了不确定的判断';
});
t('N1.6', '预算降级发生时，头部不许仍宣称「全量装载」（统计者不许谎报）', () => {
  // 别硬编预算：降级窗口的位置取决于沙箱规模，写死一个数会让判据在无效前提下变红或假绿。
  // 自己扫一遍，找出「确实丢了事实、但还没退化成最小帧」的那一档。
  let hit = null;
  const full = compileBoot(SB).text.length;
  for (let b = full; b > 400; b -= 100) {
    const r = compileBoot(SB, b);
    if (r.factsDropped > 0 && r.text.includes('── 其余学历')) { hit = { b, r }; break; }
  }
  if (!hit) return '扫遍预算区间都没出现「降级但未退化到最小帧」的档，本判据前提不成立';
  const { b, r } = hit;
  if (/当前任务全量装载/.test(r.text)) return `预算 ${b} 降了 ${r.factsDropped} 条，头部却还写着「全量装载」`;
  const m = r.text.match(/当前任务展开 (\d+)\/(\d+) 条/);
  if (!m) return `预算 ${b} 降级了却没在头部声明展开比例`;
  return Number(m[1]) === r.loaded || `头部说展开 ${m[1]} 条，实际装载 ${r.loaded} 条`;
});

// ───────────── N2 request：有 goal 那一刻才做相关性 ─────────────
t('N2.1', '给定相关目标，能调入 boot 未装载的相关事实', () => {
  const r = compileRequest(SB, '幂等账本 在实测中暴露出来的行为', { already: new Set() });
  return (r.picked.length > 0 && r.picked.every(p => p.f.claim.includes('幂等账本')))
    || `调入 ${r.picked.length} 条，主题=${r.picked.map(p => p.f.claim.slice(0, 8)).join(',')}`;
});
t('N2.2', '目标与全部学历无关时，一条都不注入（不每轮硬塞）', () => {
  const r = compileRequest(SB, '帮我订一份披萨外卖谢谢', { already: new Set() });
  return (r.text === '' && r.picked.length === 0) || `硬塞了 ${r.picked.length} 条`;
});
t('N2.3', '已注入过的不重复注入（账本去重）', () => {
  const first = compileRequest(SB, '幂等账本 在实测中暴露出来的行为', { already: new Set() });
  const seen = new Set(first.picked.map(p => p.id));
  const second = compileRequest(SB, '幂等账本 在实测中暴露出来的行为', { already: seen });
  const repeat = second.picked.filter(p => seen.has(p.id));
  return repeat.length === 0 || `重复注入了 ${repeat.length} 条`;
});
t('N2.4', '不重复注入当前任务的事实（boot 已全量给过）', () => {
  const activeClaim = ALL_FACTS.find(f => f.task === ACTIVE).claim;
  const r = compileRequest(SB, activeClaim, { already: new Set() });
  return r.picked.every(p => p.from !== `demo/${ACTIVE}/task.origin.json`)
    || '把 boot 已给过的当前任务事实又调了一遍';
});
t('N2.5', 'request 输出受预算约束', () => {
  const r = compileRequest(SB, TOPICS.join(' '), { already: new Set(), budget: 400, minScore: 0 });
  return r.text.length <= 400 + 400 || `request 输出 ${r.text.length} 字符，预算 400`;
});
t('N2.6', '相关性排序：更相关的排在前面', () => {
  const r = compileRequest(SB, '只读闸门', { already: new Set(), minScore: 0, max: 20 });
  if (r.picked.length < 2) return `候选不足（${r.picked.length}），测不出排序`;
  const scores = r.picked.map(p => p.score);
  const sorted = [...scores].sort((a, b) => b - a);
  return JSON.stringify(scores) === JSON.stringify(sorted) || '没有按相关性降序';
});
t('N2.7', 'relevance 对完全无关的文本给 0 分', () =>
  relevance('披萨外卖', '幂等账本相关的第0条已验证事实') === 0 || '无关文本得到了非零分');

// ───────────── N3 不变量：学历不会因预算而永久不可见 ─────────────
t('N3.1', '磁盘上每一条已验证事实，要么在 boot 里，要么能被检索到（三个版本都该成立的那条）', () => {
  const unreachable = [];
  for (const f of ALL_FACTS) {
    if (boot.text.includes(f.claim)) continue;                 // boot 直接给了
    const r = compileRequest(SB, f.claim, { already: new Set(), max: 30, minScore: 0.35 });
    if (!r.picked.some(p => p.f.claim === f.claim)) unreachable.push(f.claim.slice(0, 24));
  }
  return unreachable.length === 0
    || `${unreachable.length}/${ALL_FACTS.length} 条既不在 boot 里也检索不到: ${unreachable.slice(0, 3).join(' / ')}`;
});
t('N3.2', 'factId 稳定：同一条 claim 在任何时候算出同一个 id（否则去重账本失效）', () => {
  const c = ALL_FACTS[0].claim;
  return factId(c) === factId(c) && factId(c) !== factId(c + 'x') || 'factId 不稳定或不区分';
});

// ───────────── N4 hook 层：绝不能挡住用户说话 ─────────────
const runHook = input => {
  try { return execFileSync(process.execPath, [path.join(REPO, '.claude/hooks/context-request.mjs')], { input, encoding: 'utf8' }); }
  catch (e) { return '__EXIT_' + e.status; }
};
t('N4.1', 'stdin 是垃圾时静默放行（exit 0、无输出），不阻塞用户提问', () => {
  const out = runHook('这不是 JSON');
  return out === '' || `返回了 ${JSON.stringify(out.slice(0, 60))}`;
});
t('N4.2', '空提示 / 极短提示（「继续」）不触发检索', () => {
  const a = runHook(JSON.stringify({ prompt: '继续', session_id: 'x' }));
  const b = runHook(JSON.stringify({ prompt: '', session_id: 'x' }));
  return (a === '' && b === '') || `短提示触发了注入: a=${a.slice(0, 40)} b=${b.slice(0, 40)}`;
});
t('N4.3', 'hook 产出的是合法 UserPromptSubmit 契约', () => {
  const out = runHook(JSON.stringify({ prompt: '只读位挡不住删了重建 闸门边界 sed', session_id: 'nbverify-' + process.pid }));
  if (!out.trim()) return '真实仓库里这个目标没检索到东西——判据前提不成立（或相关性阈值过高）';
  const o = JSON.parse(out);
  return (o.hookSpecificOutput?.hookEventName === 'UserPromptSubmit' && !!o.hookSpecificOutput.additionalContext)
    || JSON.stringify(o).slice(0, 120);
});
t('N4.4', 'hook 的去重账本按会话隔离，且真的落盘', () => {
  const sid = 'nbverify-' + process.pid;
  const p = path.join(REPO, '.claude', `nb-injected-${sid}.json`);
  const ok = fs.existsSync(p) && JSON.parse(fs.readFileSync(p, 'utf8')).length > 0;
  try { fs.unlinkSync(p); } catch { /* 清理 */ }
  return ok || '账本没落盘或为空';
});

// ───────────────────────── 报告 ─────────────────────────
const pass = results.filter(r => r.ok).length;
console.log(`\n═══ 本源北桥 v0.2 一致性验证（${SPEC}）═══\n`);
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.id.padEnd(6)} ${r.desc}`);
  if (!r.ok) console.log(`        └─ ${r.detail}`);
}
console.log(`\n判决：${pass}/${results.length} ${pass === results.length ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
if (pass === results.length) { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { } }
else console.log(`（沙箱保留：${SB}）`);
process.exit(pass === results.length ? 0 : 1);
