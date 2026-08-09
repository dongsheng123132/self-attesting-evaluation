#!/usr/bin/env node
// crosscheck.mjs — 带外观察面 v0.1 · 对账（oob/0.1）
//
// RFC-0002 §4：**单一观察者只能提供证词，不能提供真相。真相出现在两个独立观察者的分歧处。**
//   codex 说「user cancelled」，南桥审计说「零记录」——是分歧本身指出了故障位置。
//   只信 codex 得到假结论；只信南桥只知道"没收到"。两份记录对上，真相才出来。
//
// 这台机器里有好几对互不依赖的记录，但**没有任何东西自动去对**。分歧至今全靠人撞见。
// 本文件把对账变成可重跑的动作。
//
// 与 benxiang/reobserve.mjs 的分工（别搞混）：
//   reobserve 对的是「声明 vs 世界」——过去说的话今天还成不成立（时间维度）。
//   crosscheck 对的是「记录 A vs 记录 B」——两套独立台账此刻是否互相印证（横向维度）。
//
// R2（观察者必须比被观察者笨）：本文件只做读取、计数、比对。不解释、不推断、不修复。
// bugscope §5：**结论是怀疑，不是判决。** 所以每一类分歧都必须说清它可能的良性解释。
//
//   node oob/crosscheck.mjs [--quiet]
// 退出码：0 = 无需要解释的分歧　1 = 有
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const LEDGER = process.env.OOB_CROSSCHECK_LOG || path.join(here, 'crosscheck.jsonl');
export const SPEC = 'oob/0.1';

const norm = s => String(s).split('\\').join('/');
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function findStates(dir, depth = 0, out = []) {
  if (depth > 5) return out;
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['.claude', 'node_modules', '.git', '.backups', '.benjing-backups'].includes(e.name)) continue;
      findStates(full, depth + 1, out);
    } else if (e.name === 'task.origin.json') {
      const o = readJson(full);
      if (o && o.kind === 'task.origin') out.push({ path: full, state: o });
    }
  }
  return out;
}

/** 读影核审计：写成功过的目标 + 审计从什么时候开始记（用来区分「历史遗留」和「真绕过」）*/
export function readAudit(auditPath) {
  const written = new Set();
  let since = null, lines = 0;
  try {
    for (const line of fs.readFileSync(auditPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      lines++;
      if (since === null && r.t) since = r.t;
      if ((r.status === 'done' || r.status === 'replayed') && r.target) written.add(norm(r.target));
    }
  } catch { /* 没有审计就是没有，下面按 since=null 处理 */ }
  return { written, since, lines };
}

/** X1 · 学历声称的产物 ↔ 影核审计记录。纯函数，便于反向用例喂假数据。 */
export function reconcileArtifacts(claims, audit, statAt) {
  const buckets = { matched: [], bypassed: [], out_of_scope: [], benjing_scope: [], missing: [], predates_audit: [] };
  const sinceMs = audit.since ? Date.parse(audit.since) : null;
  for (const c of claims) {
    const a = norm(c.artifact);
    const st = statAt(a);
    if (!st) { buckets.missing.push(c); continue; }
    // 学历文件走本境 benjing-put（乐观锁 + 备份），不走影核南桥。拿影核的账去查本境的活，
    // 必然全判「绕过」——那是把两个协议的辖区搞混了，是对账器自己的 bug，不是发现。
    // 首轮实测正是这么误报了 demo/task1/task.origin.json。
    if (/(^|\/)task\.origin\.json$/.test(a)) { buckets.benjing_scope.push(c); continue; }
    // 南桥白名单只管 demo/。仓库代码、schemas、机器外的路径本来就走不了它——
    // 把它们算成「违规」就是喊狼来了，bugscope §5 明令禁止硬套。
    if (!a.startsWith('demo/')) { buckets.out_of_scope.push(c); continue; }
    if (audit.written.has(a)) { buckets.matched.push(c); continue; }
    // 产物比审计还老 → 那时协议还不存在，无账是必然的，不是绕过
    if (sinceMs !== null && st.mtimeMs < sinceMs) { buckets.predates_audit.push(c); continue; }
    buckets.bypassed.push(c);   // ← 唯一需要解释的一类
  }
  return buckets;
}

/** X2 · 北桥 boot 头部的计数 ↔ 磁盘实数。黑盒：只解析它的输出文本，不碰它的内部。 */
export function parseBootClaim(text) {
  const m = String(text || '').match(/磁盘上\s*(\d+)\s*份学历[、,]\s*(\d+)\s*条已验证事实/);
  return m ? { states: Number(m[1]), facts: Number(m[2]) } : null;
}

export function crosscheck({ root = ROOT } = {}) {
  const states = findStates(root);
  const audit = readAudit(path.join(root, 'southbridge/audit.log'));

  // ── X1
  const claims = [];
  for (const { path: sp, state } of states) {
    const from = norm(path.relative(root, sp));
    for (const a of (state.artifacts || [])) claims.push({ from, artifact: a });
  }
  const statAt = (rel) => {
    const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
    try { return fs.statSync(abs); } catch { return null; }
  };
  const x1 = reconcileArtifacts(claims, audit, statAt);

  // ── X2：跑 boot hook 拿它自己说的数，再自己数一遍
  let x2 = { claimed: null, actual: null, agree: null, note: '' };
  try {
    const r = spawnSync(process.execPath, [path.join(root, '.claude/hooks/load-state.mjs')],
      { encoding: 'utf8', timeout: 20000 });
    const text = JSON.parse((r.stdout || '').trim()).hookSpecificOutput.additionalContext;
    const claimed = parseBootClaim(text);
    const actual = {
      states: states.length,
      facts: states.reduce((n, s) => n + (s.state.facts || []).filter(f => f.verified).length, 0)
    };
    x2 = claimed
      ? { claimed, actual, agree: claimed.states === actual.states && claimed.facts === actual.facts, note: '' }
      : { claimed: null, actual, agree: null, note: 'boot 输出里找不到计数声明，无从对账' };
  } catch (e) {
    x2.note = `跑 boot 失败：${e.message}`;   // 对不上账要说出来，不能当没这回事（A4）
  }

  const divergences = [];
  for (const c of x1.bypassed) divergences.push(`X1 ${c.artifact}（${c.from} 声称）在 demo/ 内、晚于审计起点，却无南桥记录`);
  for (const c of x1.missing) divergences.push(`X1 ${c.artifact}（${c.from} 声称）磁盘上不存在`);
  if (x2.agree === false) divergences.push(`X2 boot 自报 ${x2.claimed.states} 份/${x2.claimed.facts} 条，实数 ${x2.actual.states} 份/${x2.actual.facts} 条`);
  if (x2.agree === null && x2.note) divergences.push(`X2 无法对账：${x2.note}`);

  const snap = {
    spec: SPEC, kind: 'crosscheck.round', t: new Date().toISOString(),
    audit: { lines: audit.lines, since: audit.since, targets: audit.written.size },
    x1: Object.fromEntries(Object.entries(x1).map(([k, v]) => [k, v.length])),
    x2, divergences
  };
  try { fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); fs.appendFileSync(LEDGER, JSON.stringify(snap) + '\n', 'utf8'); }
  catch (e) { snap.log = `write-failed: ${e.message}`; }
  return { snap, x1 };
}

export function summary(snap) {
  const L = [];
  L.push(`① 产物对账（学历声称 ↔ 影核审计）`);
  L.push(`   有账有物 ${snap.x1.matched} · 协议外 ${snap.x1.out_of_scope}（南桥白名单只管 demo/，非违规）`);
  L.push(`   本境辖区 ${snap.x1.benjing_scope}（学历走 benjing-put，不归影核）· 早于审计 ${snap.x1.predates_audit}`);
  L.push(`   ${snap.x1.bypassed ? '⚠' : '✓'} 需要解释：demo/ 内、晚于审计起点却无记录 —— ${snap.x1.bypassed} 条`);
  L.push(`   ${snap.x1.missing ? '⚠' : '✓'} 声称了但磁盘没有 —— ${snap.x1.missing} 条`);
  L.push(`② 装载量对账（boot 自报 ↔ 磁盘实数）`);
  L.push(snap.x2.agree === true ? `   ✓ 自报与实数一致（${snap.x2.actual.states} 份 / ${snap.x2.actual.facts} 条）`
    : snap.x2.agree === false ? `   ⚠ 不一致：自报 ${snap.x2.claimed.states}/${snap.x2.claimed.facts}，实数 ${snap.x2.actual.states}/${snap.x2.actual.facts}`
    : `   ⚠ ${snap.x2.note}`);
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { snap, x1 } = crosscheck();
  if (!process.argv.includes('--quiet')) {
    console.log(`\n═══ 带外对账 · ${snap.t} ═══\n`);
    console.log(summary(snap));
    if (x1.bypassed.length) {
      console.log(`\n需要解释的（不是判决，是怀疑）：`);
      for (const c of x1.bypassed) console.log(`   • ${c.artifact}　←　${c.from}`);
      console.log(`   良性解释可能是：产物由本会话的编辑工具直接写、或由外部工具生成。`);
      console.log(`   但它意味着：这条产物没有经过风险判级、没有备份、审计里查不到是谁写的。`);
    }
    console.log(`\n判决：${snap.divergences.length === 0 ? '✅ 两套台账互相印证' : `⚠ ${snap.divergences.length} 处分歧待解释`}\n`);
  }
  process.exit(snap.divergences.length === 0 ? 0 : 1);
}
