#!/usr/bin/env node
// 斯宾塞诗节格律校准器 / 评分器。
//
// C0 闸门的全部意义：**先拿原著给验证器定基线。**
// 如果我们的检查器判斯宾塞本人不合格，那是检查器错了，不是斯宾塞错了。
// 所以合格线不是「100% 合规」，而是「落在斯宾塞自己的分布内」——
// 这条判据比 100% 更难伪造，也更诚实（见学历 demo/spenser-7-1 的 decisions）。
//
// 两个刻意的设计选择，都关乎「别把近似说成精确」：
//
// 1. 韵脚**不判绝对对错，只判相对结构**。判「brake 与 make 押不押韵」需要早期
//    现代英语的读音数据，我们没有；正字法近似会把 worse/Nurse 这类真韵判成违规。
//    改判：每一行「最像的那一行」必须与它在 ABABBCBCC 里同组（最近邻一致性）。
//    这个量不需要知道「怎么读」，只需要知道「哪几行该像」。
//    （第一版用的是组内均值 > 组间均值，被 --control 打脸——见 rhymeScore 上方注释。）
// 2. 音节数用启发式计数，必然不准（-ed 在早期现代英语常单独成音节，-ion 常读两拍）。
//    因此音节判据的产出不是「对/错」，是**偏离量的分布**，与斯宾塞本人的分布比。
//
// 用法：
//   node demo/spenser-7-1/calibrate.mjs --baseline        # 在现存六卷+变易篇上定基线
//   node demo/spenser-7-1/calibrate.mjs --score <file>     # 给一份候选文本打分并与基线比
//   node demo/spenser-7-1/calibrate.mjs --baseline --json  # 机器可读
// 退出码：0 = 跑通   2 = 候选文本落在基线之外   1 = 语料缺失/用法错

import fs from 'node:fs';
import path from 'node:path';

const CORPUS = ['demo/spenser-7-1/corpus/pg70717.txt', 'demo/spenser-7-1/corpus/pg72698.txt'];

// ── 文本清洗：斯宾塞版式里的非正文标记 ──
const clean = s => s
  .replace(/\[\d+\]/g, '')            // 脚注号 [608]
  .replace(/_/g, '')                  // 斜体下划线
  .replace(/[‘’]/g, "'")    // 弯引号
  .replace(/\s+/g, ' ')
  .trim();

// ── 诗节切分：靠版式结构，不靠内容 ──
// 首行与末行缩进 4 格，中间七行缩进 6 格；右边距可能有小写罗马数字行号。
function parseStanzas(text) {
  const lines = text.split(/\r?\n/);
  const stanzas = [];
  let buf = [];
  const flush = () => {
    if (buf.length) { stanzas.push(buf); buf = []; }
  };
  for (const raw of lines) {
    if (!raw.trim()) { flush(); continue; }
    const m = raw.match(/^( +)(\S.*)$/);
    if (!m) { flush(); continue; }
    const indent = m[1].length;
    if (indent < 3 || indent > 8) { flush(); continue; }
    // 去掉右边距的罗马数字行号
    const body = m[2].replace(/\s{2,}[ivxlcIVXLC]+\.?\s*$/, '');
    buf.push({ indent, text: clean(body) });
  }
  flush();
  // 只保留形状对得上的：9 行、首末缩进浅、中间缩进深
  return stanzas.filter(s =>
    s.length === 9 &&
    s[0].indent < s[1].indent &&
    s[8].indent < s[7].indent
  ).map(s => s.map(l => l.text));
}

// ── 音节启发式计数 ──
function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z']/g, '');
  if (!w) return 0;
  w = w.replace(/'/g, '');
  if (!w) return 0;
  let groups = w.match(/[aeiouy]+/g) || [];
  let n = groups.length;
  // 词尾静音 e（但 -le 结尾成音节：little / battle）
  if (/[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w) && n > 1) n--;
  return Math.max(1, n);
}
const lineSyllables = line => line.split(/\s+/).filter(Boolean).reduce((a, w) => a + syllables(w), 0);

// ── 韵脚：只比「哪几行该像」，不判「押得对不对」──
function rhymeTail(line) {
  const words = line.replace(/[^A-Za-z' ]/g, ' ').trim().split(/\s+/);
  const last = (words[words.length - 1] || '').toLowerCase().replace(/'/g, '');
  return last;
}
// 两词共同后缀长度（归一化）
function tailSim(a, b) {
  if (!a || !b) return 0;
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i / Math.max(2, Math.min(a.length, b.length));
}
// ABABBCBCC → 0-based 分组
const GROUPS = [[0, 2], [1, 3, 4, 6], [5, 7, 8]];
const groupOf = i => GROUPS.findIndex(g => g.includes(i));

// 最近邻一致性：每一行「最像的那一行」必须与它同组。
//
// 第一版用的是「组内平均相似度 > 组间平均」，被 --control 当场打脸：
// 置换 [0,5,2,7,8,1,4,3,6] 只是把韵类**换了标签**（韵还在，只是不再是 ABABBCBCC），
// 均值比较照样通过。均值分不出「押韵」与「按这个韵式押韵」，而后者才是判据。
// 最近邻不看阈值、不看均值，只问「你最像谁」，因此对重贴标签敏感。
function rhymeScore(stanza) {
  const tails = stanza.map(rhymeTail);
  let bad = 0;
  const detail = [];
  for (let i = 0; i < 9; i++) {
    let best = -1, bestSim = -1;
    for (let j = 0; j < 9; j++) {
      if (j === i) continue;
      const s = tailSim(tails[i], tails[j]);
      if (s > bestSim) { bestSim = s; best = j; }
    }
    if (groupOf(best) !== groupOf(i)) { bad++; detail.push(`L${i + 1}(${tails[i]})→L${best + 1}(${tails[best]})`); }
  }
  return { bad, ok: bad === 0, detail };
}

// ── 一份文本的整体测量 ──
function measure(stanzas) {
  const out = {
    stanzas: stanzas.length,
    rhyme_pattern_violations: 0,
    line9_short: 0,           // 末行未比前八行长（亚历山大格的核心特征）
    syll_1_8: [],             // 前八行音节数分布
    syll_9: []                // 末行音节数分布
  };
  for (const s of stanzas) {
    if (!rhymeScore(s).ok) out.rhyme_pattern_violations++;
    const first8 = s.slice(0, 8).map(lineSyllables);
    const l9 = lineSyllables(s[8]);
    out.syll_1_8.push(...first8);
    out.syll_9.push(l9);
    const mean8 = first8.reduce((a, b) => a + b, 0) / 8;
    if (l9 <= mean8) out.line9_short++;
  }
  const stat = a => {
    const s = [...a].sort((x, y) => x - y);
    const mean = a.reduce((x, y) => x + y, 0) / (a.length || 1);
    return { n: a.length, mean: +mean.toFixed(2), median: s[Math.floor(s.length / 2)] ?? 0, p10: s[Math.floor(s.length * 0.1)] ?? 0, p90: s[Math.floor(s.length * 0.9)] ?? 0 };
  };
  return {
    stanzas: out.stanzas,
    rhyme_violation_rate: +(out.rhyme_pattern_violations / (out.stanzas || 1)).toFixed(4),
    line9_not_longer_rate: +(out.line9_short / (out.stanzas || 1)).toFixed(4),
    syll_1_8: stat(out.syll_1_8),
    syll_9: stat(out.syll_9)
  };
}

// ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const asJson = args.includes('--json');

function loadCorpus() {
  const missing = CORPUS.filter(f => !fs.existsSync(f));
  if (missing.length) {
    console.error(`缺语料：${missing.join(', ')}\n先跑 node demo/fetch-corpus.mjs spenser-7-1`);
    process.exit(1);
  }
  return CORPUS.flatMap(f => parseStanzas(fs.readFileSync(f, 'utf8')));
}

if (args.includes('--baseline')) {
  const stanzas = loadCorpus();
  if (stanzas.length < 1000) {
    console.error(`只切出 ${stanzas.length} 个诗节——远少于《仙后》应有的数千个，切分逻辑有问题，基线不作数`);
    process.exit(1);
  }
  const m = measure(stanzas);
  if (asJson) { console.log(JSON.stringify(m, null, 2)); process.exit(0); }
  console.log('\n═══ C0 校准：斯宾塞本人的分布 ═══\n');
  console.log(`  切出诗节            ${m.stanzas}`);
  console.log(`  韵式结构违规率      ${(m.rhyme_violation_rate * 100).toFixed(2)}%   ← 这就是合格线，不是 0%`);
  console.log(`  末行未长于前八行    ${(m.line9_not_longer_rate * 100).toFixed(2)}%`);
  console.log(`  前八行音节  均值 ${m.syll_1_8.mean}  中位 ${m.syll_1_8.median}  P10–P90 ${m.syll_1_8.p10}–${m.syll_1_8.p90}   (理论值 10)`);
  console.log(`  末行音节    均值 ${m.syll_9.mean}  中位 ${m.syll_9.median}  P10–P90 ${m.syll_9.p10}–${m.syll_9.p90}   (理论值 12)`);
  console.log('\n读法：新写的一章必须落在以上分布内，而不是「零违规」。');
  console.log('零违规反而是可疑的——它意味着比原作者还规整，那不是像斯宾塞，那是像格律机器。\n');
  process.exit(0);
}

// ── 对照：检查器必须能变红 ──
// 基线跑出 0.00% 韵式违规时，唯一负责任的反应是怀疑检查器恒绿。
// 把每个诗节的行做固定置换（破坏 ABABBCBCC 而不改动任何一个词），
// 违规率必须显著上升；不上升就说明这条判据什么都没测。
if (args.includes('--control')) {
  const stanzas = loadCorpus();
  const base = measure(stanzas);
  const PERMS = [
    { name: '相邻互换 (BABA…)', p: [1, 0, 3, 2, 4, 6, 5, 8, 7] },
    { name: '整节倒序', p: [8, 7, 6, 5, 4, 3, 2, 1, 0] },
    { name: '循环移一位', p: [1, 2, 3, 4, 5, 6, 7, 8, 0] },
    { name: '三组打散', p: [0, 5, 2, 7, 8, 1, 4, 3, 6] }
  ];
  console.log('\n═══ 对照：破坏韵式，检查器是否变红 ═══\n');
  console.log(`  原样                 ${(base.rhyme_violation_rate * 100).toFixed(2)}%`);
  let allRed = true;
  for (const { name, p } of PERMS) {
    const shuffled = stanzas.map(s => p.map(i => s[i]));
    const r = measure(shuffled).rhyme_violation_rate;
    const red = r > base.rhyme_violation_rate + 0.2;   // 至少高出 20 个百分点才算「变红」
    if (!red) allRed = false;
    console.log(`  ${name.padEnd(20)} ${(r * 100).toFixed(2)}%  ${red ? '✅ 变红' : '❌ 没反应'}`);
  }
  console.log(allRed
    ? '\n✅ 四种破坏全部被抓住：基线 vs 破坏后的分离度足够大，这条判据是真的在判\n'
    : '\n⛔ 有破坏没被抓住：这条判据的 0% 不可信\n');
  process.exit(allRed ? 0 : 2);
}

const scoreIdx = args.indexOf('--score');
if (scoreIdx >= 0 && args[scoreIdx + 1]) {
  const f = args[scoreIdx + 1];
  if (!fs.existsSync(f)) { console.error(`没有这份文本：${f}`); process.exit(1); }
  const base = measure(loadCorpus());
  const cand = measure(parseStanzas(fs.readFileSync(f, 'utf8')));
  if (!cand.stanzas) { console.error('候选文本里一个合规形状的诗节都没切出来（9 行、首末行缩进浅于中间七行）'); process.exit(2); }

  // 落在基线之外的判定：韵式违规率不得超过基线的 2 倍，音节均值不得偏离基线 1 个音节以上
  const problems = [];
  if (cand.rhyme_violation_rate > base.rhyme_violation_rate * 2)
    problems.push(`韵式违规率 ${(cand.rhyme_violation_rate * 100).toFixed(1)}% > 基线两倍 ${(base.rhyme_violation_rate * 200).toFixed(1)}%`);
  if (Math.abs(cand.syll_1_8.mean - base.syll_1_8.mean) > 1)
    problems.push(`前八行音节均值 ${cand.syll_1_8.mean} 偏离基线 ${base.syll_1_8.mean} 超过 1`);
  if (Math.abs(cand.syll_9.mean - base.syll_9.mean) > 1)
    problems.push(`末行音节均值 ${cand.syll_9.mean} 偏离基线 ${base.syll_9.mean} 超过 1`);
  if (cand.line9_not_longer_rate > Math.max(0.15, base.line9_not_longer_rate * 2))
    problems.push(`末行未长于前八行的比例 ${(cand.line9_not_longer_rate * 100).toFixed(1)}% 过高`);

  if (asJson) { console.log(JSON.stringify({ baseline: base, candidate: cand, problems }, null, 2)); process.exit(problems.length ? 2 : 0); }
  console.log(`\n═══ 评分：${f} ═══\n`);
  console.log(`                      候选        斯宾塞基线`);
  console.log(`  诗节数              ${String(cand.stanzas).padEnd(12)}${base.stanzas}`);
  console.log(`  韵式违规率          ${(cand.rhyme_violation_rate * 100).toFixed(2).padEnd(12)}%${(base.rhyme_violation_rate * 100).toFixed(2)}%`);
  console.log(`  前八行音节均值      ${String(cand.syll_1_8.mean).padEnd(12)}${base.syll_1_8.mean}`);
  console.log(`  末行音节均值        ${String(cand.syll_9.mean).padEnd(12)}${base.syll_9.mean}`);
  console.log(`  末行未变长比例      ${(cand.line9_not_longer_rate * 100).toFixed(2).padEnd(12)}%${(base.line9_not_longer_rate * 100).toFixed(2)}%`);
  if (problems.length) { console.log('\n⛔ 落在基线之外：'); for (const p of problems) console.log('  • ' + p); }
  else console.log('\n✅ 落在斯宾塞自己的分布内');
  process.exit(problems.length ? 2 : 0);
}

console.error('用法: node demo/spenser-7-1/calibrate.mjs --baseline | --score <file> [--json]');
process.exit(1);
