#!/usr/bin/env node
// verify-naming.mjs — 命名一致性判据（naming/0.1）
//
// 为什么有这个文件：`2origin-computer/NAMING-DECISION.md §5` 立了一条规矩——
// **名字也要走 candidate → verified**，没有判据钉住的名字只能是 candidate。
// 但那条规矩立完之后，它自己**只存在于文档里**——正是同一份裁决 §5.1 批评的那个病
// （「一条只存在于文档里的约束等于不存在」，与「没人加载的 schema」同型）。
//
// 本文件是它的可执行形态。最值钱的两条来自当天人肉才发现的真缺陷：
//   N3 一名两物：TERMINOLOGY 主表里「学堂」出现两次，一次指部件一次指整个循环——
//      **就发生在那张专门用来消除一名两物的表里**，且当天被改过两次都没被发现。
//   N4 一物两名：ActionParity 与 action kernel 并存于同一体系的两份文档。
// 清单查得出的东西，通读查不出。
//
// **首跑 5/9，四条红全是仪器缺陷、一条是真缺陷**，逐条记在对应判据旁，不抹掉：
// 仪器把自己的毛病说成被测对象的毛病，是论文 class B 的形状。
//
//   node governance/verify-naming.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observe } from '../benxiang/observe.mjs';
import { aliasCandidates } from '../southbridge/benjing-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TERM = path.join(REPO, 'TERMINOLOGY.md');

const results = [];
const t = (id, desc, fn) => {
  try { const r = fn(); results.push({ id, desc, ok: r === true, detail: r === true ? '' : String(r) }); }
  catch (e) { results.push({ id, desc, ok: false, detail: 'EXCEPTION: ' + e.message }); }
};

/**
 * 解析术语表主表。
 * **解析失败必须抛错，不许返回空数组**——一个「什么都没解析到所以全绿」的验证器
 * 是恒绿考题（学堂判据批的那种），比没有验证器更坏。
 */
export function parseTerms(mdText) {
  const lines = mdText.split(/\r?\n/);
  const start = lines.findIndex(l => l.trim() === '## 主表');
  if (start < 0) throw new Error('找不到「## 主表」——表结构变了，解析器必须当场失败而不是静默跳过');
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('## ')) break;
    if (!l.startsWith('| ') || l.startsWith('|---')) continue;
    const p = l.split('|').map(x => x.trim());
    if (p.length < 6 || p[1] === '中文') continue;
    rows.push({ zh: p[1], en: p[2], what: p[3], where: p[4], spec: p[5], line: i + 1 });
  }
  if (!rows.length) throw new Error('主表解析出 0 行——解析器与表结构已脱节');
  return rows;
}

/** 从「代码在哪」一列抽出真正的路径（反引号内、含 / 或 .mjs 的那些）。 */
export function extractPaths(where) {
  const out = [];
  for (const m of where.matchAll(/`([^`]+)`/g)) {
    const s = m[1].trim();
    if (/[/\\]/.test(s) || /\.mjs$/.test(s)) out.push(s);
  }
  return out;
}

/**
 * 路径是否命中盘上至少一个文件。看世界只走本象，并过别名表。
 *
 * **首跑缺陷①**：通配只支持文件名那一段，于是把 `demo/*​/task.origin.json` 这类
 * 目录级通配报成缺失——两条真实存在的路径被判成不存在。改成逐段展开。
 */
function existsOnDisk(rel) {
  const tryOne = p => {
    if (!p.includes('*')) return observe(p, REPO).properties.exists;
    let cands = [''];
    for (const seg of p.split('/')) {
      const next = [];
      for (const base of cands) {
        if (!seg.includes('*')) { next.push(base ? base + '/' + seg : seg); continue; }
        const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        try {
          for (const e of fs.readdirSync(path.join(REPO, base || '.')))
            if (re.test(e)) next.push(base ? base + '/' + e : e);
        } catch { /* 该层目录不存在 */ }
      }
      cands = next;
      if (!cands.length) return false;
    }
    return cands.some(c => observe(c, REPO).properties.exists);
  };
  return aliasCandidates(rel).some(tryOne);
}

const md = fs.readFileSync(TERM, 'utf8');
const terms = parseTerms(md);

// ── N1/N2 声称的代码必须真的在盘上 ────────────────────────────────────────────
t('N1', '术语表声称的每条代码路径都真实存在（走本象观察 + 别名表）', () => {
  const bad = [];
  for (const r of terms) for (const p of extractPaths(r.where)) if (!existsOnDisk(p)) bad.push(`${r.zh}→${p}`);
  return bad.length === 0 || `声称了但盘上没有：${bad.join('; ')}`;
});

t('N2', '【反向】把不存在的路径写进表必须被抓住（探针不能恒绿）', () => {
  // **首跑缺陷②**：假行被追加在真文档**末尾**，而解析器只认第一个「## 主表」，
  // 于是假行根本没进表——那次测的是空气。反向用例必须先确认自己注入成功了。
  const fake = ['## 主表',
    '| 中文 | English | 它到底是什么 | 代码在哪 | 规范 |',
    '|---|---|---|---|---|',
    '| 假部件 | fake | 不存在的东西 | `nowhere/does-not-exist.mjs` | — |'].join('\n');
  const injected = parseTerms(fake).find(r => r.zh === '假部件');
  if (!injected) return '注入的假行没被解析到——反向用例在测空气';
  return !existsOnDisk(extractPaths(injected.where)[0]) || '不存在的路径被判成存在';
});

// ── N3 一名两物：当天人肉才发现的那个缺陷，从此由机器查 ────────────────────────
t('N3', '主表内不得一名两物（同一个中文名指两个不同的东西）', () => {
  const seen = new Map(), dup = [];
  for (const r of terms) {
    if (seen.has(r.zh)) dup.push(`「${r.zh}」第 ${seen.get(r.zh)} 行与第 ${r.line} 行`);
    else seen.set(r.zh, r.line);
  }
  return dup.length === 0 || `一名两物：${dup.join('；')}——这正是本表存在的理由，而它自己犯过一次`;
});

t('N3.2', '【反向】人为制造重名必须被 N3 的逻辑抓住', () => {
  const fake = [...terms, { ...terms[0], line: 9999 }];
  const seen = new Map(); let caught = false;
  for (const r of fake) { if (seen.has(r.zh)) caught = true; else seen.set(r.zh, r.line); }
  return caught || 'N3 的查重逻辑对人造重名视而不见';
});

// ── N4 一物两名：同一份实现被两个部件名声称 ──────────────────────────────────
t('N4', '主表内不得一物两名（同一份实现被两个部件名声称）', () => {
  // **首跑缺陷③**：按「提取出的第一个路径」比较，于是把学历与经验判成一物两名——
  // 学历指整份 task.origin.json，经验指其中的 `learnings[]`，两者位置声称并不相同。
  // 改按整段 where 比较。
  const byWhere = new Map();
  for (const r of terms) {
    if (!extractPaths(r.where).length) continue;
    const key = r.where.replace(/\s+/g, '');
    if (!byWhere.has(key)) byWhere.set(key, []);
    byWhere.get(key).push(r.zh);
  }
  const dup = [...byWhere.entries()].filter(([, n]) => new Set(n).size > 1)
    .map(([p, n]) => `${p} 同时被 ${[...new Set(n)].join('/')} 声称`);
  return dup.length === 0 || dup.join('；');
});

// ── N5 verified 的操作化定义：有判据钉着 ──────────────────────────────────────
const verifiers = fs.readdirSync(REPO, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
  .flatMap(d => {
    try {
      return fs.readdirSync(path.join(REPO, d.name))
        .filter(f => /^verify-.*\.mjs$/.test(f)).map(f => path.join(REPO, d.name, f));
    } catch { return []; }
  });
const verifierText = verifiers.map(f => fs.readFileSync(f, 'utf8')).join('\n');

t('N5', '每个声称了实现的部件都至少被一条判据钉着（verified 的操作化定义）', () => {
  const naked = [];
  for (const r of terms) {
    const ps = extractPaths(r.where);
    if (!ps.length) continue;                                  // 概念项，本判据不管
    // **首跑缺陷④**：只查「判据文本里有没有实现文件名」，于是把影核报成没有判据——
    // 而影核那套（verify-southbridge 53 条）是 spawn 子进程跑 CLI 测的，从不 import 实现。
    // 三条任一命中即算钉住：实现文件名 / spec id / 部件中文名。
    const specId = (r.spec.match(/`([^`]+)`/) || [])[1];
    const hit = ps.some(p => {
      const stem = path.posix.basename(p).replace(/\*/g, '').replace(/\.mjs$/, '');
      return stem.length > 2 && verifierText.includes(stem);
    }) || (specId && verifierText.includes(specId)) || verifierText.includes(r.zh);
    if (!hit) naked.push(`${r.zh}（${ps.join(',')}）`);
  }
  // 没有判据钉着不等于「错」，等于**这个名字只能是 candidate**。这里只报依据，
  // 由读的人决定是补判据还是把它降级——决策权与判断依据分离。
  return naked.length === 0
    || `以下部件在表里像既有部件，却没有任何判据钉着，按 §5.2 只能算 candidate：${naked.join('; ')}`;
});

t('N6', '【反向】判据集合本身不能是空的（否则 N5 恒绿）', () =>
  (verifiers.length >= 5 && verifierText.length > 10000)
  || `只扫到 ${verifiers.length} 个验证器 / ${verifierText.length} 字节——N5 会因此恒绿`);

t('N7', '【反向】表结构变化必须让解析器当场失败，不许静默返回空表', () => {
  try { parseTerms('# 没有主表的文档\n随便写点什么'); return '解析器对缺失的主表视而不见'; }
  catch { /* 期望抛错 */ }
  try { parseTerms('## 主表\n（这里一行表格都没有）'); return '解析器对空表视而不见'; }
  catch { return true; }
});

t('N8', '别名表被真正接进来：新名写法要能解到仍在盘上的旧目录', () =>
  existsOnDisk('quxiang/observe.mjs')
  || '新名解不开——PATH_ALIASES 没被用上（本仓库当前正是文档新名、目录旧名的状态）');

// ───────────────────────── 报告 ─────────────────────────
const pass = results.filter(r => r.ok).length;
console.log('\n═══ 命名一致性验证（naming/0.1）═══');
console.log(`术语表：${path.relative(REPO, TERM)}`);
console.log(`主表 ${terms.length} 条　判据集 ${verifiers.length} 份\n`);
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.id.padEnd(5)} ${r.desc}`);
  if (!r.ok) console.log(`        └─ ${r.detail}`);
}
console.log(`\n判决：${pass}/${results.length} ${pass === results.length ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
process.exit(pass === results.length ? 0 : 1);
