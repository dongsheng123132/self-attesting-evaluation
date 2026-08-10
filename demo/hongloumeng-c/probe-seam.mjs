#!/usr/bin/env node
/**
 * probe-seam.mjs — 「后四十回接缝」独立重算探针（C 轨 W0 预研，不是验证器）
 *
 * 它做什么：用虚字相对频率做变点扫描，问「120 回里最像换人的那一刀在哪」。
 * 它不做什么：它不判定作者是谁，也不是本仓意义上的判据（没有 C0 校准闸门）。
 *
 * 为什么带置换检验：任何变点扫描在任何文本上都必然返回一个「最佳切点」。
 * 不给零分布，就等于交了一道恒绿考题（学堂判据 X3 的反面）。
 * 置换检验就是这道题的反向用例：把回次顺序打乱后，同样的扫描应当找不到这么强的接缝。
 *
 * 用法：node probe-seam.mjs [--json] [--perm N] [--corpus <path>]
 * 退出码：0=跑通  1=用法/数据错
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// 分回与韵文识别是「这本书长什么样」的观察，不是本探针的私事——走共享实现
import { splitChapters, verseSplit } from './corpus.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const N_PERM = Number(argv[argv.indexOf('--perm') + 1]) || 2000;
const CORPUS = argv.includes('--corpus')
  ? argv[argv.indexOf('--corpus') + 1]
  : join(__dir, 'corpus', 'pg24264-honglou.txt');
// 对照本用：同一套程序换一本书跑，回数不同
const N_CHAP = Number(argv[argv.indexOf('--chapters') + 1]) || 120;
// 去韵文：前八十回诗词曲赋密度远高于后四十回，而诗词大量用文言虚字（之/方/與/曾）。
// 不排掉，「作者不同」与「韵文密度不同」就分不开——这是本探针最大的混淆项。
const STRIP_VERSE = argv.includes('--strip-verse');

// ── 虚字表 ────────────────────────────────────────────────────────────────
// 只取虚字（功能词），不取实词：实词频率跟「这一回讲什么」强相关，
// 会把「题材变化」误判成「作者变化」。这是计量文体学的标准做法。
// 该 Gutenberg 版本是繁简混排（转码遗留），故每个特征把异体合并计数。
const FEATURES = [
  ['的'], ['了'], ['是'], ['在'], ['有'], ['不'], ['也'], ['都'], ['又'],
  ['就'], ['只'], ['便'], ['把'], ['被'], ['向'], ['從', '从'], ['到'],
  ['與', '与'], ['而'], ['且'], ['因'], ['所'], ['者'], ['之'], ['其'],
  ['此'], ['何'], ['這', '这'], ['那'], ['麼', '么'], ['呢'], ['罷', '吧'],
  ['呀'], ['啊'], ['並', '并'], ['卻', '却'], ['倒'], ['越'], ['更'],
  ['再'], ['還', '还'], ['已'], ['曾'], ['正'], ['剛', '刚'], ['才'],
  ['個', '个'], ['們', '们'], ['很'], ['最'], ['太'], ['多'], ['少'],
  ['如'], ['若'], ['雖', '虽'], ['但'], ['然'], ['則', '则'], ['乃'],
  ['即'], ['須', '须'], ['必'], ['可'], ['能'], ['會', '会'], ['要'],
  ['說', '说'], ['道'], ['著', '着'], ['過', '过'], ['來', '来'], ['去'],
  ['上'], ['下'], ['裡', '里', '裏'], ['中'], ['見', '见'], ['聽', '听'],
  ['難道', '难道'], ['越發', '越发'], ['自然'], ['究竟'], ['橫豎', '横竖'],
  ['索性'], ['竟'], ['忽'], ['遂'], ['方'], ['甚'], ['麼樣', '么样'],
];

// ── 特征矩阵 ──────────────────────────────────────────────────────────────
function countOf(text, variants) {
  let c = 0;
  for (const v of variants) {
    let idx = 0;
    while ((idx = text.indexOf(v, idx)) !== -1) { c++; idx += v.length; }
  }
  return c;
}

function buildMatrix(chapters) {
  const rows = chapters.map(ch => {
    const { verse, prose } = verseSplit(ch.text);
    const vLen = verse.replace(/\s+/g, '').length;
    const full = ch.text.replace(/\s+/g, '');
    const clean = STRIP_VERSE ? prose.replace(/\s+/g, '') : full;
    const denom = clean.length || 1;
    return {
      n: ch.n, len: denom,
      verse_ratio: full.length ? vLen / full.length : 0,
      f: FEATURES.map(v => countOf(clean, v) / denom),
    };
  });
  // 按列 z-score：不做的话「的/了」这种高频字会独吞整个距离
  const P = FEATURES.length, M = rows.length;
  const z = rows.map(r => r.f.slice());
  for (let p = 0; p < P; p++) {
    const col = rows.map(r => r.f[p]);
    const mu = col.reduce((a, b) => a + b, 0) / M;
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - mu) ** 2, 0) / (M - 1)) || 1e-12;
    for (let i = 0; i < M; i++) z[i][p] = (rows[i].f[p] - mu) / sd;
  }
  return { rows, z };
}

// ── 变点扫描 ──────────────────────────────────────────────────────────────
// Score(k) = 前 k 回 vs 后 (M-k) 回，各特征 Welch t 的绝对值均值。
// 用均值而非最大值：单个特征的偶然偏离不足以造出一个接缝。
function scoreAt(z, k) {
  const M = z.length, P = z[0].length;
  if (k < 5 || M - k < 5) return 0;
  let acc = 0;
  for (let p = 0; p < P; p++) {
    let sa = 0, sb = 0;
    for (let i = 0; i < k; i++) sa += z[i][p];
    for (let i = k; i < M; i++) sb += z[i][p];
    const ma = sa / k, mb = sb / (M - k);
    let va = 0, vb = 0;
    for (let i = 0; i < k; i++) va += (z[i][p] - ma) ** 2;
    for (let i = k; i < M; i++) vb += (z[i][p] - mb) ** 2;
    va /= (k - 1); vb /= (M - k - 1);
    const se = Math.sqrt(va / k + vb / (M - k)) || 1e-12;
    acc += Math.abs(ma - mb) / se;
  }
  return acc / P;
}

function scanAll(z) {
  const M = z.length;
  const curve = [];
  for (let k = 10; k <= M - 10; k++) curve.push({ k, score: scoreAt(z, k) });
  const best = curve.reduce((a, b) => (b.score > a.score ? b : a));
  return { curve, best };
}

// 确定性 PRNG（mulberry32）：换机器换时间必须复现同一个 p 值
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function permutationNull(z, nPerm, seed = 20260809) {
  const rand = rng(seed);
  const M = z.length;
  const idx = Array.from({ length: M }, (_, i) => i);
  const maxes = [];
  for (let t = 0; t < nPerm; t++) {
    for (let i = M - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const zp = idx.map(i => z[i]);
    maxes.push(scanAll(zp).best.score);
  }
  maxes.sort((a, b) => a - b);
  return maxes;
}

// ── 主流程 ────────────────────────────────────────────────────────────────
let raw;
try { raw = readFileSync(CORPUS, 'utf8'); }
catch { console.error(`读不到语料：${CORPUS}`); process.exit(1); }

const chapters = splitChapters(raw, N_CHAP);
const { rows, z } = buildMatrix(chapters);
const { curve, best } = scanAll(z);
const nullMax = permutationNull(z, N_PERM);
const nGE = nullMax.filter(v => v >= best.score).length;
const pValue = (nGE + 1) / (N_PERM + 1);

// 观测曲线上「传统切点」的排名（红楼梦=80，其他书用 --ref 指定，落不到区间就为 null）
const REF = Number(argv[argv.indexOf('--ref') + 1]) || 80;
const sorted = curve.slice().sort((a, b) => b.score - a.score);
const atRef = curve.find(c => c.k === REF) || null;
const rankRef = atRef ? sorted.findIndex(c => c.k === REF) + 1 : null;

// 韵文密度：接缝的头号混淆项，必须和接缝一起报
const vFront = rows.slice(0, best.k).reduce((a, r) => a + r.verse_ratio, 0) / best.k;
const vBack = rows.slice(best.k).reduce((a, r) => a + r.verse_ratio, 0) / (rows.length - best.k);

// 哪些虚字在 k* 处分得最开（可检视性：结论必须能被人翻查，不能是黑箱）
function topDrivers(k, topN = 12) {
  const M = z.length;
  const out = FEATURES.map((v, p) => {
    let sa = 0, sb = 0;
    for (let i = 0; i < k; i++) sa += rows[i].f[p];
    for (let i = k; i < M; i++) sb += rows[i].f[p];
    const ma = sa / k, mb = sb / (M - k);
    let va = 0, vb = 0;
    for (let i = 0; i < k; i++) va += (z[i][p] - ma / 1) ** 0;
    return { word: v[0], front: ma, back: mb, ratio: mb / (ma || 1e-12), t: Math.abs(scoreOne(p, k)) };
  });
  return out.sort((a, b) => b.t - a.t).slice(0, topN);
}
function scoreOne(p, k) {
  const M = z.length;
  let sa = 0, sb = 0;
  for (let i = 0; i < k; i++) sa += z[i][p];
  for (let i = k; i < M; i++) sb += z[i][p];
  const ma = sa / k, mb = sb / (M - k);
  let va = 0, vb = 0;
  for (let i = 0; i < k; i++) va += (z[i][p] - ma) ** 2;
  for (let i = k; i < M; i++) vb += (z[i][p] - mb) ** 2;
  va /= (k - 1); vb /= (M - k - 1);
  return (ma - mb) / (Math.sqrt(va / k + vb / (M - k)) || 1e-12);
}

const result = {
  corpus: CORPUS,
  chapters: chapters.length,
  chars_total: rows.reduce((a, r) => a + r.len, 0),
  features: FEATURES.length,
  strip_verse: STRIP_VERSE,
  best_split: best.k,
  best_score: Number(best.score.toFixed(4)),
  ref_split: REF,
  score_at_ref: atRef ? Number(atRef.score.toFixed(4)) : null,
  rank_of_ref: rankRef,
  verse_ratio_front: Number((vFront * 100).toFixed(2)),
  verse_ratio_back: Number((vBack * 100).toFixed(2)),
  candidates_scanned: curve.length,
  permutations: N_PERM,
  perm_null_median: Number(nullMax[Math.floor(N_PERM / 2)].toFixed(4)),
  perm_null_max: Number(nullMax[N_PERM - 1].toFixed(4)),
  p_value: Number(pValue.toFixed(5)),
  top_drivers: topDrivers(best.k),
  top5_splits: sorted.slice(0, 5).map(c => ({ k: c.k, score: Number(c.score.toFixed(4)) })),
};

if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

console.log('═══ 红楼梦 · 接缝探针（虚字变点扫描 + 置换检验）═══\n');
console.log(`语料      ${CORPUS}`);
console.log(`回数      ${result.chapters}    计入字数 ${result.chars_total.toLocaleString()}    虚字特征 ${result.features}`);
console.log(`韵文      ${STRIP_VERSE ? '已剔除五言/七言整行' : '未剔除（含诗词）'}`);
console.log(`\n扫描了 ${result.candidates_scanned} 个候选切点`);
console.log(`最强接缝  k = ${result.best_split}    Score = ${result.best_score}`);
if (atRef) console.log(`k=${REF} 处   Score = ${result.score_at_ref}   在 ${result.candidates_scanned} 个候选里排第 ${result.rank_of_ref}`);
console.log(`韵文密度  前 ${result.verse_ratio_front}%  →  后 ${result.verse_ratio_back}%（按 k=${best.k} 分）`);
console.log('\n前 5 强切点：' + result.top5_splits.map(c => `k=${c.k}(${c.score})`).join('  '));
console.log(`\n—— 反向用例：置换检验（打乱回次顺序 ${N_PERM} 次，种子固定）——`);
console.log(`零分布中位数 ${result.perm_null_median}    零分布最大值 ${result.perm_null_max}`);
console.log(`观测值 ${result.best_score} 的 p = ${result.p_value}`);
console.log(result.p_value < 0.01
  ? '→ 接缝强度显著超出「顺序无关」零分布：这条缝不是扫描程序自己造出来的。'
  : '→ 接缝强度落在零分布内：本探针无法宣称存在真实接缝。');
console.log('\n—— 分得最开的虚字（前→后 每万字频次）——');
for (const d of result.top_drivers) {
  const f = (d.front * 10000).toFixed(1), b = (d.back * 10000).toFixed(1);
  console.log(`  ${d.word.padEnd(4, '　')} 前 ${f.padStart(7)}  →  后 ${b.padStart(7)}   (×${d.ratio.toFixed(2)})  |t|=${d.t.toFixed(1)}`);
}
console.log('\n注：本探针只回答「哪一刀最像换人」，不回答「后四十回作者是谁」。');
console.log('    它也不是本仓意义上的判据——判据必须先过 C0 校准闸门。');
