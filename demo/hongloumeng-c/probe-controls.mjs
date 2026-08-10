#!/usr/bin/env node
/**
 * probe-controls.mjs — 对照矩阵：变点扫描的自我证伪
 *
 * 它检验的那条经验：
 *   「虚字变点扫描 + 置换检验」不足以支撑「换作者」的结论，
 *   因为公认单作者的长篇白话小说同样会给出 p 触底的显著接缝。
 *
 * 这条经验被违反时本脚本会变红：
 *   若哪天对照本（西游记）不再显著，说明「显著=换人」重新变得可信，
 *   这条经验就该被推翻 —— 于是本脚本 exit 1，学堂考试会把它降级。
 *
 * 用法：node probe-controls.mjs [--json] [--perm N]
 * 退出码：0=经验仍成立（对照本同样显著）  1=经验被推翻或跑不通
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const PERM = argv.includes('--perm') ? argv[argv.indexOf('--perm') + 1] : '500';

const BOOKS = [
  { key: 'honglou', name: '紅樓夢', file: 'pg24264-honglou.txt', chapters: 120, role: '被测' },
  { key: 'xiyou', name: '西遊記', file: 'pg23962.txt', chapters: 100, role: '对照·单作者' },
  { key: 'shuihu', name: '水滸傳(70回本)', file: 'pg23863.txt', chapters: 70, role: '对照·成书复杂' },
];

const rows = [];
for (const b of BOOKS) {
  const out = execFileSync('node', [
    join(__dir, 'probe-seam.mjs'), '--json', '--perm', PERM,
    '--corpus', join(__dir, 'corpus', b.file), '--chapters', String(b.chapters),
  ], { encoding: 'utf8', maxBuffer: 1e8 });
  const r = JSON.parse(out);
  rows.push({ ...b, k: r.best_split, score: r.best_score, p: r.p_value, nullMax: r.perm_null_max });
}

const subject = rows.find(r => r.key === 'honglou');
const controls = rows.filter(r => r.role.startsWith('对照'));
// 经验成立的条件：对照本也显著。只要有一本对照不显著，「显著即换人」就重新站得住，
// 这条经验就被推翻了。
const controlsAlsoSignificant = controls.every(c => c.p <= 0.01);
const verdict = controlsAlsoSignificant ? 'HOLDS' : 'REFUTED';

if (asJson) {
  console.log(JSON.stringify({ verdict, permutations: Number(PERM), rows }, null, 2));
} else {
  console.log('═══ 变点扫描 · 对照矩阵 ═══\n');
  console.log('书'.padEnd(20, ' ') + '角色'.padEnd(14, ' ') + '最强切点   强度    零分布上限     p');
  for (const r of rows) {
    console.log(r.name.padEnd(20, ' ') + r.role.padEnd(14, ' ')
      + ('k*=' + r.k).padEnd(11) + r.score.toFixed(3).padStart(5)
      + r.nullMax.toFixed(3).padStart(12) + ('p=' + r.p).padStart(12));
  }
  console.log(`\n被测书最强接缝 k=${subject.k}，强度 ${subject.score.toFixed(3)}`);
  console.log(`对照本是否同样显著：${controlsAlsoSignificant ? '是' : '否'}`);
  console.log(verdict === 'HOLDS'
    ? '\n→ 经验成立：置换检验只能排除「程序造缝」，排不掉「长篇小说本来就有缝」。\n  单凭文体统计的显著性不足以支撑「换作者」。'
    : '\n→ 经验被推翻：对照本不再显著，「显著即换人」重新可信，该降级这条经验。');
}
process.exit(verdict === 'HOLDS' ? 0 : 1);
