#!/usr/bin/env node
// reobserve.mjs — 本象 v0.1「回头看」（benxiang/0.1）
//
// 装了观察器还不够。实测：影核 audit.log 里 772 条带 evidence 的声明，
// 今天仍与世界一致的只有 8 条 —— **写完那一眼之后，再没有人回头看过。**
//
// 「写完立刻回读」修的是「声明当场就是假的」；
// 「回头看」修的是「声明当场为真，之后世界变了而没人知道」。
// 这是两个不同的病，影核 v0.2 只修了前一个。
//
// 本工具做三件事，全部只信磁盘真相：
//   1. 学历自身：content_hash 是否仍与内容相符、只读闸门是否还在
//   2. 活的声明：学历 artifacts[] 声称的产物现在还在不在
//   3. 历史声明：影核 audit.log 的 evidence 与今天的世界差多远（统计，不报警——历史就是历史）
//
// 输出落 benxiang/observations.jsonl —— 这是「上次被独立观察是什么时候」的账本，
// 以前这个问题在本仓库没有任何地方能回答。
//
//   node benxiang/reobserve.mjs [--quiet]
// 退出码：0=活的声明全部与世界一致  1=存在漂移或缺失
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observe, compare, SPEC } from './observe.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const quiet = process.argv.includes('--quiet');
const log = (...a) => { if (!quiet) console.log(...a); };

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function findStateFiles(dir, depth = 0, out = []) {
  if (depth > 5) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['.claude', 'node_modules', '.git', '.svn', '.backups', 'benxiang'].includes(e.name)) continue;
      findStateFiles(full, depth + 1, out);
    } else if (e.name === 'task.origin.json') {
      const o = readJson(full);
      if (o && o.kind === 'task.origin') out.push(full);
    }
  }
  return out;
}

const report = { spec: SPEC, kind: 'observation.round', at: new Date().toISOString(), states: [], live_claims: [], history: null };
let alerts = 0;

// ── 1. 学历自身 ──────────────────────────────────────
log(`\n═══ 本象回头看 · ${new Date().toISOString()} ═══\n`);
log('① 学历自身');
for (const sp of findStateFiles(ROOT)) {
  const rel = path.relative(ROOT, sp).replace(/\\/g, '/');
  const o = observe(sp, ROOT);
  const s = readJson(sp);
  const p = o.properties;
  const row = {
    path: rel, observed_sha256: p.sha256, writable: p.writable,
    json_ok: !p.json_parse_error, json_kind: p.json_kind, version: s?.version ?? null
  };
  // 本象不知道 content_hash 怎么算（那是本境的规矩），只报它看到的事实；
  // 「指纹对不对」由本境自己判。观察与判断分离。
  const issues = [];
  if (p.json_parse_error) { issues.push('JSON 解析失败'); alerts++; }
  if (p.writable) { issues.push('只读闸门掉了'); alerts++; }
  if (p.json_kind !== 'task.origin') { issues.push(`kind=${JSON.stringify(p.json_kind)}`); alerts++; }
  row.issues = issues;
  report.states.push(row);
  log(`   ${issues.length ? '⚠' : '✓'} ${rel.padEnd(40)} v${row.version ?? '?'} ${issues.join('；')}`);
}

// ── 2. 活的声明：学历声称的产物 ────────────────────────
log('\n② 活的声明（学历 artifacts[] 声称存在的产物）');
let liveOk = 0, liveGone = 0;
for (const sp of findStateFiles(ROOT)) {
  const s = readJson(sp); if (!s) continue;
  const rel = path.relative(ROOT, sp).replace(/\\/g, '/');
  for (const a of (s.artifacts || [])) {
    const o = observe(a, ROOT);
    const ok = o.properties.exists;
    report.live_claims.push({ from: rel, artifact: a, exists: ok, sha256: o.properties.sha256 || null });
    if (ok) liveOk++; else { liveGone++; alerts++; log(`   ✗ ${rel} 声称的 ${a} 已不存在`); }
  }
}
log(`   ${liveGone ? '' : '✓ '}${liveOk} 条仍成立，${liveGone} 条已失效`);

// ── 2b. 与上一轮比：这才是「回头看」，只看一眼不算 ──────
// 学历没有记录 artifact 的指纹（只记路径），所以「产物内容变没变」以前是无人可答的。
// 账本让它可答：拿这一轮的观察跟上一轮比。
log('\n②b 与上一轮观察相比');
const ledgerPath = path.join(here, 'observations.jsonl');
let prev = null;
try {
  const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length) prev = JSON.parse(lines[lines.length - 1]);
} catch { /* 首轮没有账本 */ }

if (!prev) log('   （首轮，无可比对象——下次跑就有了）');
else {
  const prevMap = new Map((prev.live_claims || []).map(c => [c.from + '|' + c.artifact, c]));
  let changed = 0, appeared = 0, vanished = 0;
  for (const c of report.live_claims) {
    const k = c.from + '|' + c.artifact, o = prevMap.get(k);
    if (!o) { appeared++; continue; }
    prevMap.delete(k);
    if (o.exists && !c.exists) { vanished++; alerts++; log(`   ✗ ${c.artifact} 上轮还在，现在没了`); }
    else if (o.exists && c.exists && o.sha256 && c.sha256 && o.sha256 !== c.sha256) {
      changed++; log(`   ~ ${c.artifact} 内容变了（${o.sha256.slice(0, 8)} → ${c.sha256.slice(0, 8)}）`);
    }
  }
  for (const [k, o] of prevMap) if (o.exists) { vanished++; alerts++; log(`   ✗ ${k} 上轮声称存在，本轮学历里已不再声称`); }
  log(`   上轮 ${prev.at}：新增声明 ${appeared} · 内容变动 ${changed} · 失效 ${vanished}`);
  report.compared_with = prev.at;
  report.delta = { appeared, changed, vanished };
}

// ── 3. 历史声明：影核 audit.log ───────────────────────
log('\n③ 历史声明（影核 audit.log 的 evidence vs 今天的世界）');
const auditPath = path.join(ROOT, 'southbridge/audit.log');
if (fs.existsSync(auditPath)) {
  let withEv = 0, match = 0, gone = 0, drifted = 0;
  const seen = new Set();
  for (const line of fs.readFileSync(auditPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const rel = r.target || r.relpath, ev = r.evidence || {};
    if (!rel || !ev.sha256) continue;
    withEv++;
    const key = rel + '|' + ev.sha256;
    if (seen.has(key)) continue;
    seen.add(key);
    const v = compare(observe(rel, ROOT), { sha256: ev.sha256, size_bytes: ev.size_bytes });
    if (v.verdict === 'match') match++; else if (v.verdict === 'gone') gone++; else drifted++;
  }
  report.history = { claims_with_evidence: withEv, unique: seen.size, still_true: match, gone, drifted };
  log(`   ${withEv} 条带证据的声明（去重后 ${seen.size} 条）`);
  log(`   仍成立 ${match} · 目标已不存在 ${gone} · 内容已漂移 ${drifted}`);
  log(`   → 历史声明本身不算故障（记的是「当时」）。真正的问题是：`);
  log(`     这些声明从写下那一刻起，到本次回头看之前，从没有被任何机制重新观察过。`);
} else log('   （无 audit.log）');

// ── 落账本 ──────────────────────────────────────────
const ledger = path.join(here, 'observations.jsonl');
try { fs.appendFileSync(ledger, JSON.stringify(report) + '\n', 'utf8'); }
catch (e) { console.error('账本写入失败:', e.message); }

log(`\n判决：${alerts === 0 ? '✅ 活的声明与世界一致' : `❌ ${alerts} 处需要处理`}`);
log(`账本：benxiang/observations.jsonl（这是「上次被独立观察是什么时候」的唯一答案来源）\n`);
process.exit(alerts === 0 ? 0 : 1);
