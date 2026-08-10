#!/usr/bin/env node
/**
 * verify-zhipi-spec.mjs — 脂批断言表的自校验（W1-2 产物的守门人）
 *
 * 与 verify-panci-spec 同族，但多查两件 W1-1 不需要查的事：
 *
 *  1. **批语原文逐字可复核**：网上流传的「脂批说……」大量无出处，
 *     其中不乏后人转述与演绎。凡引不出原文的线索一律不能进判据。
 *  2. **批本出处必须落实**：每条批语要报出自哪个批本、哪一回，
 *     且该批本名必须真的出现在原文的批语标记里（不是我编的标签）。
 *
 * 另检查证据等级：等级 B（已佚、仅存过录文的靖藏本）不得单独支撑 L1 判据。
 * 孤证 + 底本已佚 还敢定成「明确可判」，是判据造假最常见的形态。
 *
 * 用法：node verify-zhipi-spec.mjs [--json] [--selftest]
 * 退出码：0=全部可复核且结构自洽  1=有编造/错字/出处落空/等级越权
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const SELFTEST = argv.includes('--selftest');

const spec = JSON.parse(readFileSync(join(__dir, 'zhipi-spec.json'), 'utf8'));
const raw = JSON.parse(readFileSync(join(__dir, 'corpus/zhipi-raw.json'), 'utf8'));

const norm = s => s.replace(/[\s　]/g, '');
const CORPUS = norm(Object.values(raw).join('\n'));
// 按回索引，用于核对「这条批语真的在它自称的那一回里」
const BY_CH = {};
for (const [title, content] of Object.entries(raw)) {
  const ch = title.split('/').pop();
  BY_CH[ch] = (BY_CH[ch] || '') + norm(content);
}

// ── 反向用例 ──────────────────────────────────────────────────────────────
if (SELFTEST) {
  const FAKES = [
    '惜「衛若蘭射箭」文字無稿',                    // 改字：真文是「射圃」
    '故後文方有「懸崖撒手」一迴',                  // 改字：真文是「一回」
    '後觀《情榜》評曰「寶玉情不情」，「寶釵情冷」', // 后半段是编的
    '脂硯齋云後三十回寫湘雲嫁與寶玉',              // 整条是坊间流传的说法，原文没有
  ];
  const REAL = [
    '惜「衛若蘭射圃」文字無稿',
    '故後文方有「懸崖撒手」一回',
    '後觀《情榜》評曰',
    '茜雪至「獄神廟」方呈正文',
  ];
  console.log('═══ 反向用例：分不分得开真批语与假批语 ═══\n');
  const badFakes = FAKES.filter(f => CORPUS.includes(norm(f)));
  const badReals = REAL.filter(r => !CORPUS.includes(norm(r)));
  for (const f of FAKES) console.log(`  ${CORPUS.includes(norm(f)) ? '❌ 假批语被放过' : '✅ 假批语被抓住'}  「${f}」`);
  for (const r of REAL) console.log(`  ${CORPUS.includes(norm(r)) ? '✅ 真批语被认出' : '❌ 真批语被误杀'}  「${r}」`);
  const ok = badFakes.length === 0 && badReals.length === 0;
  console.log(ok ? '\n→ 检查器有判别力。' : '\n→ ❌ 检查器无判别力，其「全部命中」不可信。');
  process.exit(ok ? 0 : 1);
}

const problems = [];
const stats = { entries: 0, batches: 0, assertions: 0, L1: 0, L2: 0, L3: 0, gradeA: 0, gradeB: 0 };

for (const e of spec.entries) {
  stats.entries++;
  const gradeOf = {};

  for (const b of e.batches || []) {
    stats.batches++;
    stats[b.grade === 'A' ? 'gradeA' : 'gradeB']++;
    const n = norm(b.text);
    if (!CORPUS.includes(n)) { problems.push(`${e.id}：批语原文在语料里找不到 →「${b.text.slice(0, 24)}…」`); continue; }
    // 出处落实：这条批语必须真的在它自称的那一回
    const chBlob = BY_CH[b.chapter];
    if (!chBlob) problems.push(`${e.id}：自称出处「${b.chapter}」在语料里没有这一回`);
    else if (!chBlob.includes(n)) problems.push(`${e.id}：批语确实存在，但不在自称的「${b.chapter}」里`);
    // 批本归属：只查「该批本名在本回出现过」是不够的——庚辰批遍布全回，那样等于恒绿。
    // 要查的是：这段批语文字的**紧邻前置标记**是否正是所声明的批本。
    else {
      const idx = chBlob.indexOf(n);
      const marker = /([甲庚戚蒙靖][^：【】]{0,7})：/g;
      let last = null, m;
      while ((m = marker.exec(chBlob)) !== null) {
        if (m.index >= idx) break;
        last = m[1];
      }
      if (last !== norm(b.edition))
        problems.push(`${e.id}：出处标错——该批语的紧邻前置标记是「${last || '（无）'}」，不是声明的「${b.edition}」`);
    }
    gradeOf[n] = b.grade;
  }

  for (const a of e.assertions || []) {
    stats.assertions++;
    if (!['L1', 'L2', 'L3'].includes(a.level)) { problems.push(`${a.id}：level 非法`); continue; }
    stats[a.level]++;
    if (!a.grounding) { problems.push(`${a.id}：缺 grounding`); continue; }
    const g = norm(a.grounding);
    if (!CORPUS.includes(g)) { problems.push(`${a.id}：grounding 找不到 →「${a.grounding.slice(0, 24)}…」`); continue; }

    // grounding 落在哪条批语上，就继承那条的证据等级
    let grade = null;
    for (const [btext, bg] of Object.entries(gradeOf)) if (btext.includes(g)) { grade = grade === 'A' ? 'A' : bg; }
    if (grade === 'B' && a.level === 'L1')
      problems.push(`${a.id}：证据等级 B（孤证/底本已佚）却定为 L1 明确可判 —— 等级越权`);
    if (grade === 'B' && !a.provenance_caveat)
      problems.push(`${a.id}：依据等级 B 的批语却未标 provenance_caveat`);

    if (a.level === 'L3' && a.check) problems.push(`${a.id}：L3 却带了 check`);
    if (a.level !== 'L3' && !a.check) problems.push(`${a.id}：${a.level} 却没给 check`);
    if (a.level === 'L2' && !a.interpretation_rule && !a.level_reason)
      problems.push(`${a.id}：L2 必须给出解释规则或理由`);
  }
}

const result = { ok: problems.length === 0, stats, problems };

if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(result.ok ? 0 : 1); }

console.log('═══ 脂批断言表 · 自校验（W1-2）═══\n');
console.log(`线索条目      ${stats.entries}`);
console.log(`引用批语      ${stats.batches} 条（等级A 现存实物批本 ${stats.gradeA}　等级B 已佚过录本 ${stats.gradeB}）`);
console.log(`断言总数      ${stats.assertions}`);
console.log(`  L1 明确可判  ${stats.L1}`);
console.log(`  L2 需解释    ${stats.L2}`);
console.log(`  L3 不可判    ${stats.L3}`);
if (problems.length) {
  console.log(`\n❌ ${problems.length} 处问题：`);
  for (const p of problems) console.log('  • ' + p);
} else {
  console.log('\n✅ 每条批语逐字命中语料、出处落在自称的那一回、批本名见于原文标记；等级 B 未越权支撑 L1。');
}
process.exit(result.ok ? 0 : 1);
