#!/usr/bin/env node
// benjing-todo.mjs — 待办的单一真相源与完成传播（本境配套工具）
//
// 出血点（2026-08-08 实测）：同一件待办散落在多份学历里，关掉它要改多处，漏一处就成僵尸。
//   「Experience Bank + 长循环考试」同时挂在 task2/3/4/6（4 处）
//   「southbridge_verify 与写同进程」挂在 task3/5/6（3 处）
//   「codex MCP 闸门」挂在 task3/5（2 处）
// 而且已经有一条实测衰减了：task7 的「两个仓库尚未提交」写下不久就有一半不成立，
// 没有任何机制发现，是关会话前人工核对时撞见的。
//
// 这台机器的主张是「越用越会」。可待办只增不减、完成了不传播，学历越厚僵尸越多、
// boot 注入的噪音越大——那就成了「越用越糊涂」。这是唯一一个会反向侵蚀主张本身的缺陷。
//
// 设计原则（RFC-0002 R2 + bugscope §5）：
//   **模糊匹配只用于报告，精确匹配才用于动手。**
//   查重是启发式的，可能错——所以它只负责「指出可疑」，把分数打出来让人判断。
//   删除是破坏性的——所以只认调用者给的字面子串，绝不自己猜该删哪条。
//
//   node southbridge/benjing-todo.mjs list [--dupes]
//   node southbridge/benjing-todo.mjs close "<字面子串>" --reason "<为什么可以关>" [--dry-run]
// 退出码：0 成功/无重复　1 用法错　2 有重复待办（list --dupes）　3 有状态写入失败
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const PUT = path.join(here, 'benjing-put.mjs');
const LEDGER = process.env.BENJING_TODO_LEDGER || path.join(here, 'todo-closures.jsonl');

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

export function findStates(root = ROOT) {
  const out = [];
  const walk = (dir, d = 0) => {
    if (d > 5) return;
    let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['.claude', 'node_modules', '.git', '.backups', '.benjing-backups'].includes(e.name)) continue;
        walk(full, d + 1);
      } else if (e.name === 'task.origin.json') {
        const o = readJson(full);
        if (o && o.kind === 'task.origin') out.push({ file: path.relative(root, full).split('\\').join('/'), state: o });
      }
    }
  };
  walk(root);
  return out;
}

// ── 查重：字符 3-gram 的 Jaccard。中文没空格，词级分不开；这是最笨够用的做法。
// 它会有假阳性，所以分数一定要打出来，由人判断——不自动合并、不自动删除。
export function grams(s) {
  const t = String(s || '').toLowerCase().replace(/[\s，。、（）()【】\[\]:：—·-]+/g, '');
  const g = new Set();
  for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3));
  return g;
}
export function similarity(a, b) {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 找出跨学历重复的待办。threshold 默认 0.5，可调；返回按相似度降序的分组。 */
export function findDuplicates(states, threshold = 0.5) {
  const items = [];
  for (const s of states) for (const step of (s.state.next_steps || [])) items.push({ file: s.file, step: String(step) });
  const groups = [];
  const used = new Set();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const g = [{ ...items[i], score: 1 }];
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j) || items[j].file === items[i].file) continue;
      const sc = similarity(items[i].step, items[j].step);
      if (sc >= threshold) { g.push({ ...items[j], score: Number(sc.toFixed(2)) }); used.add(j); }
    }
    if (g.length > 1) { used.add(i); groups.push(g); }
  }
  return groups.sort((a, b) => b.length - a.length);
}

function putState(file, nextObj) {
  const show = spawnSync(process.execPath, [PUT, '--show', file], { encoding: 'utf8', cwd: ROOT });
  let hash = null;
  try { hash = JSON.parse(show.stdout).computed_hash; } catch { /* 下面按 null 处理 */ }
  if (!hash) return { ok: false, reason: `拿不到 computed_hash：${(show.stderr || show.stdout || '').trim().slice(0, 120)}` };
  const tmp = path.join(os.tmpdir(), `benjing-todo-${process.pid}-${Math.abs(hash.charCodeAt(0))}.json`);
  fs.writeFileSync(tmp, JSON.stringify(nextObj, null, 2), 'utf8');
  const r = spawnSync(process.execPath, [PUT, file, '--expect', hash, '--from', tmp], { encoding: 'utf8', cwd: ROOT });
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  // 退出码 3 = diverged（有人在这中间改过），必须报出来让人去合并，不能重试硬写
  if (r.status !== 0) return { ok: false, reason: `benjing-put 退出码 ${r.status}: ${(r.stdout || r.stderr || '').trim().slice(0, 160)}` };
  return { ok: true, out: r.stdout.trim() };
}

/** 关闭：只认字面子串。命中即整条移除，并在该学历里留一条 fact 说明是谁关的、凭什么。 */
export function close(substr, reason, { dryRun = false, root = ROOT, when = new Date().toISOString() } = {}) {
  const hits = [];
  for (const s of findStates(root)) {
    const keep = [], removed = [];
    for (const step of (s.state.next_steps || [])) (String(step).includes(substr) ? removed : keep).push(step);
    if (removed.length) hits.push({ file: s.file, removed, keep, state: s.state });
  }
  const results = [];
  if (dryRun) return { hits, results, dryRun: true };

  for (const h of hits) {
    // 必须重新读盘：hits 里那份是扫描时的快照，期间可能已被别的会话改过
    const fresh = readJson(path.join(root, h.file));
    if (!fresh) { results.push({ file: h.file, ok: false, reason: '重新读盘失败' }); continue; }
    const keep = (fresh.next_steps || []).filter(x => !String(x).includes(substr));
    const removed = (fresh.next_steps || []).filter(x => String(x).includes(substr));
    if (!removed.length) { results.push({ file: h.file, ok: true, skipped: '重新读盘后已无命中（别人先关了）' }); continue; }
    fresh.next_steps = keep;
    fresh.facts = fresh.facts || [];
    fresh.facts.push({
      claim: `待办已关闭（跨学历传播）：${removed.map(x => String(x).slice(0, 60)).join(' / ')}。理由：${reason}`,
      verified: true,
      source: `node southbridge/benjing-todo.mjs close "${substr}" --reason "…"；关闭台账 southbridge/todo-closures.jsonl`,
      when
    });
    const r = putState(h.file, fresh);
    results.push({ file: h.file, ok: r.ok, reason: r.reason, removed: removed.length });
  }

  const entry = { kind: 'todo.closure', t: when, substr, reason, files: results.map(r => r.file), results };
  try { fs.appendFileSync(LEDGER, JSON.stringify(entry) + '\n', 'utf8'); }
  catch (e) { entry.log = `write-failed: ${e.message}`; }   // 台账写不进去要说出来
  return { hits, results, ledger: entry.log || 'ok' };
}

// ───────────────────────── CLI ─────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [verb, ...rest] = process.argv.slice(2);
  const flag = n => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };

  if (verb === 'list') {
    const states = findStates();
    // 阈值可调，且默认值必须打出来：0.5 是拍的，没有调参依据。
    // 实测它会漏——task2 那条「实施 actionable-notes.md 优先级：#4 Experience Bank + #2 长循环考试」
    // 与 task3/4/6 的「task2 遗留：Experience Bank + 长循环考试」是同一件事，措辞差太多，0.5 抓不到。
    // 所以这东西是**降低漏检成本的工具，不是漏检为零的保证**。
    const th = Number(flag('--threshold') || 0.5);
    const groups = findDuplicates(states, th);
    if (rest.includes('--dupes')) {
      if (!groups.length) { console.log(`✓ 阈值 ${th} 下没有跨学历的重复待办（阈值是拍的，调低再看一遍）`); process.exit(0); }
      console.log(`⚠ ${groups.length} 组疑似重复待办（相似度阈值 ${th}，是怀疑不是判决）：\n`);
      groups.forEach((g, i) => {
        console.log(`【${i + 1}】挂在 ${g.length} 份学历上`);
        g.forEach(x => console.log(`   ${String(x.score).padEnd(5)} ${x.file}\n         ${x.step.slice(0, 88)}`));
        console.log();
      });
      console.log('关闭时用字面子串，别用相似度：node southbridge/benjing-todo.mjs close "<子串>" --reason "…"');
      process.exit(2);
    }
    for (const s of states) {
      if (!(s.state.next_steps || []).length) continue;
      console.log(`[${s.file}]`);
      s.state.next_steps.forEach(x => console.log('   -', String(x).slice(0, 100)));
    }
    process.exit(0);
  }

  if (verb === 'close') {
    const substr = rest[0];
    const reason = flag('--reason');
    if (!substr || substr.startsWith('--') || !reason) {
      console.error('用法: benjing-todo.mjs close "<字面子串>" --reason "<为什么可以关>" [--dry-run]');
      console.error('  理由是必填的：一条待办凭什么可以关，是后来人唯一能复核的东西。');
      process.exit(1);
    }
    const dryRun = rest.includes('--dry-run');
    const { hits, results } = close(substr, reason, { dryRun });
    if (!hits.length) { console.log(`没有学历的 next_steps 含子串 ${JSON.stringify(substr)}`); process.exit(0); }
    if (dryRun) {
      console.log(`[dry-run] 将从 ${hits.length} 份学历移除：`);
      hits.forEach(h => { console.log(`  ${h.file}`); h.removed.forEach(x => console.log(`     - ${String(x).slice(0, 90)}`)); });
      process.exit(0);
    }
    let bad = 0;
    results.forEach(r => {
      if (r.skipped) console.log(`  ~ ${r.file} ${r.skipped}`);
      else if (r.ok) console.log(`  ✓ ${r.file} 移除 ${r.removed} 条`);
      else { bad++; console.log(`  ✗ ${r.file} ${r.reason}`); }
    });
    console.log(bad ? `\n⚠ ${bad} 份未能写入——它们的待办还在，别当成已关` : `\n✓ 已在 ${results.length} 份学历上同步关闭，台账 southbridge/todo-closures.jsonl`);
    process.exit(bad ? 3 : 0);
  }

  console.error('用法: benjing-todo.mjs list [--dupes] | close "<子串>" --reason "…" [--dry-run]');
  process.exit(1);
}
