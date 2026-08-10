#!/usr/bin/env node
/**
 * verify-panci-spec.mjs — 判词断言表的自校验（W1-1 产物的守门人）
 *
 * 它防的是什么：我在写 panci-spec.json 时，可以顺手写下一句「原文」，
 * 而那句话根本不在第五回里——凭记忆写古文，错一个字是常态，整句记串也不稀奇。
 * 一旦 grounding 是编的，后面所有判据都建在假地基上，且没有任何人会发现。
 *
 * 所以：**每一条断言引用的 grounding，必须逐字出现在落盘的第五回原文里。**
 * 找不到就红。这跟本仓「fact 的 source 必须引可复核物」是同一条规矩，
 * 只是这次被引的可复核物是曹雪芹的原文。
 *
 * 同时输出可判性分布——这个数字决定 C 轨到底有没有骨头：
 * 若 L1 条目太少，这台判分器判不动任何东西，整条轨该现在就停。
 *
 * 用法：node verify-panci-spec.mjs [--json]
 * 退出码：0=全部 grounding 可复核且结构合法  1=有编造/错字/结构错误
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const asJson = process.argv.includes('--json');

const SELFTEST = process.argv.includes('--selftest');

const spec = JSON.parse(readFileSync(join(__dir, 'panci-spec.json'), 'utf8'));
const primary = readFileSync(join(__dir, spec.sources.primary.path.replace('demo/hongloumeng-c/', '')), 'utf8');
const secondary = readFileSync(join(__dir, spec.sources.secondary.path.replace('demo/hongloumeng-c/', '')), 'utf8');

// 归一化：去掉一切空白（含全角空格）、wiki 标记、以及只影响排印的符号。
// 不做繁简转换、不做异体归并——那会把「异文」这个我们要抓的东西抹掉。
const norm = s => s
  .replace(/<[^>]*>/g, '')
  .replace(/'''/g, '')
  .replace(/[\s　]/g, '');

const P = norm(primary);
const S = norm(secondary);

// ── 反向用例 ──────────────────────────────────────────────────────────────
// 「全部命中」有两种可能：检查器真的在查，或者它根本没在查。
// 下面三条是故意造的假原文：像古文、像判词、但第五回里没有。
// 检查器必须把三条全抓出来；抓不全就说明它是道恒绿考题，本脚本立即红。
if (SELFTEST) {
  const FAKES = [
    '金釵雪裏埋香骨',            // 改字：真文是「金簪雪裏埋」
    '一載赴黃泉',                // 改字：真文是「一載赴黃粱」
    '白茫茫大地真乾淨無餘',      // 加尾：真文到「真乾淨」为止
  ];
  const REAL = ['金簪雪裏埋', '一載赴黃粱', '落了片白茫茫大地真乾淨'];
  const normLocal = s => s.replace(/<[^>]*>/g, '').replace(/'''/g, '').replace(/[\s　]/g, '');
  const src = normLocal(primary) + normLocal(secondary);
  const missedFakes = FAKES.filter(f => src.includes(normLocal(f)));
  const missedReals = REAL.filter(r => !src.includes(normLocal(r)));
  console.log('═══ 反向用例：检查器分不分得开真假原文 ═══\n');
  for (const f of FAKES) console.log(`  ${src.includes(normLocal(f)) ? '❌ 假原文被放过' : '✅ 假原文被抓住'}  「${f}」`);
  for (const r of REAL) console.log(`  ${src.includes(normLocal(r)) ? '✅ 真原文被认出' : '❌ 真原文被误杀'}  「${r}」`);
  const ok = missedFakes.length === 0 && missedReals.length === 0;
  console.log(ok
    ? '\n→ 检查器有判别力：假的红、真的绿。'
    : '\n→ ❌ 检查器无判别力，它给出的「全部命中」不可信。');
  process.exit(ok ? 0 : 1);
}

const problems = [];
const stats = { entries: 0, assertions: 0, L1: 0, L2: 0, L3: 0, grounded: 0, only_in_secondary: 0 };
const perChar = [];

function checkQuote(q, where) {
  // grounding 允许用 " / " 并列多条原文，逐条都要能找到
  const parts = q.split(' / ').map(x => x.trim()).filter(Boolean);
  let allOk = true;
  for (const p of parts) {
    const n = norm(p);
    if (P.includes(n)) { stats.grounded++; continue; }
    if (S.includes(n)) { stats.grounded++; stats.only_in_secondary++; continue; }
    allOk = false;
    problems.push(`${where}：grounding 在两个底本里都找不到 →「${p}」`);
  }
  return allOk;
}

for (const e of spec.entries) {
  stats.entries++;
  const charStat = { character: e.character, L1: 0, L2: 0, L3: 0 };

  // 判词/曲正文本身也必须可复核
  if (e.panci) checkQuote(e.panci, `${e.id} 判词正文`);
  if (e.song) {
    for (const k of Object.keys(e.song)) {
      if (k.startsWith('text_')) checkQuote(e.song[k], `${e.id} 曲「${(e.song.names || []).join('/')}」`);
    }
  }

  for (const a of e.assertions || []) {
    stats.assertions++;
    if (!['L1', 'L2', 'L3'].includes(a.level)) {
      problems.push(`${a.id}：level 非法「${a.level}」`);
      continue;
    }
    stats[a.level]++; charStat[a.level]++;
    if (!a.grounding) { problems.push(`${a.id}：缺 grounding`); continue; }
    checkQuote(a.grounding, a.id);

    // 结构自洽：L3 不许带 check（不可判的东西不能有判法），L1/L2 必须带 check
    if (a.level === 'L3' && a.check) problems.push(`${a.id}：定为 L3（不可判）却带了 check，自相矛盾`);
    if (a.level !== 'L3' && !a.check) problems.push(`${a.id}：定为 ${a.level}（可判）却没给 check，等于没说怎么判`);
    // L2 必须声明解释规则，否则「需解释」是句空话
    if (a.level === 'L2' && !a.interpretation_rule && !a.level_reason)
      problems.push(`${a.id}：L2 必须给出解释规则或理由`);
  }
  perChar.push(charStat);
}

// 骨头够不够：L1 是判分器唯一不需要辩论就能用的部分
const bones = stats.L1;
const charsWithL1 = perChar.filter(c => c.L1 > 0).length;

const result = {
  ok: problems.length === 0,
  stats,
  chars_total: perChar.length,
  chars_with_L1: charsWithL1,
  problems,
  per_character: perChar,
};

if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(result.ok ? 0 : 1); }

console.log('═══ 判词断言表 · 自校验（W1-1）═══\n');
console.log(`条目（人物/组）  ${stats.entries}`);
console.log(`断言总数        ${stats.assertions}`);
console.log(`  L1 明确可判    ${stats.L1}`);
console.log(`  L2 需解释可判  ${stats.L2}`);
console.log(`  L3 不可判      ${stats.L3}（已显式排除，不进判据集）`);
console.log(`原文引用可复核   ${stats.grounded} 处${stats.only_in_secondary ? `（其中 ${stats.only_in_secondary} 处只在次底本命中 = 异文）` : ''}`);
console.log(`有 L1 断言的人物 ${charsWithL1} / ${perChar.length}`);

console.log('\n—— 逐人物可判性 ——');
for (const c of perChar) {
  const bar = 'L1×' + String(c.L1).padEnd(2) + ' L2×' + String(c.L2).padEnd(2) + ' L3×' + c.L3;
  console.log(`  ${c.character.padEnd(14, '　')} ${bar}${c.L1 === 0 ? '   ⚠ 无硬断言' : ''}`);
}

if (problems.length) {
  console.log(`\n❌ ${problems.length} 处问题：`);
  for (const p of problems) console.log('  • ' + p);
} else {
  console.log('\n✅ 全部 grounding 逐字命中落盘原文，结构自洽。');
}

console.log(`\n骨头够不够：L1 共 ${bones} 条，覆盖 ${charsWithL1} 个人物/组。`);
console.log(bones >= 20 && charsWithL1 >= 10
  ? '→ C 轨成立：判分器有足够多不需要辩论的硬考题。'
  : '→ ⚠ 骨头不足：可判条目太少，应当现在就重新考虑 C 轨是否值得做。');

process.exit(result.ok ? 0 : 1);
