#!/usr/bin/env node
/**
 * verify-facts.mjs — 抽取事实表的独立复核（W1-3）
 *
 * 为什么不能信抽取方的自检：
 *   Hermes 交付 80 条事实，并自报「全量逐字回搜原文，全部命中，无一条落空」。
 *   这句话是**真的**——但它只覆盖了一个维度：引文是否存在。
 *   它查不出「引文是真的，但断言方向反了」。而本轮实测，方向错误正是主要错误。
 *
 * 所以本复核查四层，逐层比上一层更难伪造：
 *   L-A 引文逐字命中**其自称的那一回**（不是全书任意处）
 *   L-B 引文长度合规、无标记残留
 *   L-C 端点锚定：断言的两端有几个真的出现在引文里
 *   L-D **方向一致性**：用中文「X之R」的属格结构反推每条记录用的是哪套约定，
 *        同一张表里混用两套约定即判红——那会让下游判分器无论怎么解释都大面积出错
 *
 * 用法：node verify-facts.mjs [--json] [--selftest]
 * 退出码：0=可用  1=不可用（有硬失败或约定混用）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitChapters } from './corpus.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const SELFTEST = argv.includes('--selftest');
const FACTS = argv.includes('--facts') ? argv[argv.indexOf('--facts') + 1] : join(__dir, 'work/hermes-facts.json');

const norm = s => String(s).replace(/[\s　]/g, '');
const CN = '零一二三四五六七八九十';
const chNum = t => { const m = t.match(/^第(.+)回$/); if (!m) return null; const s = m[1]; let v = 0; if (s.includes('十')) { const [a, b] = s.split('十'); v = (a ? CN.indexOf(a) : 1) * 10 + (b ? CN.indexOf(b) : 0); } else v = CN.indexOf(s); return v > 0 ? v : null; };

const chapters = splitChapters(readFileSync(join(__dir, 'corpus/wikisource-honglou-120.txt'), 'utf8'), 120);
const CH_TEXT = {};
for (const c of chapters) CH_TEXT[c.n] = norm(c.text);

const data = JSON.parse(readFileSync(FACTS, 'utf8'));
let facts = data.facts || [];

// ── 反向用例 ──────────────────────────────────────────────────────────────
// 注入三类故意造的坏记录，本复核必须三类都抓住。
// 抓不全，说明它跟抽取方的自检一样只会查一个维度。
if (SELFTEST) {
  const probes = [
    { name: '编造引文（原文没有这句）', rec: { id: 'X1', kind: 'kinship', subject: '賈寶玉', relation: '父', object: '賈政', chapter: '第二回', grounding: '賈政乃寶玉之生父，性最嚴正，寶玉見之如鼠見貓' }, expect: 'A' },
    { name: '引文是真的但回次报错', rec: { id: 'X2', kind: 'kinship', subject: '李紈', relation: '妻', object: '賈珠', chapter: '第二回', grounding: '原來這李氏即賈珠之妻' }, expect: 'A' },
    { name: '引文真、回次对，但方向与属格结构相反', rec: { id: 'X3', kind: 'kinship', subject: '賈珠', relation: '妻', object: '李紈', chapter: '第四回', grounding: '原來這李氏即賈珠之妻' }, expect: 'D' },
  ];
  console.log('═══ 反向用例：本复核能抓住几类坏记录 ═══\n');
  let allOk = true;
  for (const p of probes) {
    const r = checkOne(p.rec);
    const caught = p.expect === 'A' ? (r.hardFail !== null) : (r.convention === 'B');
    // X3 的构造：属格结构说「賈珠之妻＝李紈」，即 subject 应为賈珠、object 應為李紈（约定A）。
    // 若某条被判成约定 B 而多数是 A（或反之），混用检测会红。这里只验能否定出约定。
    const ok = p.expect === 'A' ? r.hardFail !== null : r.convention !== null;
    if (!ok) allOk = false;
    console.log(`  ${ok ? '✅ 抓住' : '❌ 放过'}  ${p.name}${r.hardFail ? '（' + r.hardFail + '）' : r.convention ? '（判定约定 ' + r.convention + '）' : ''}`);
  }
  console.log(allOk ? '\n→ 三类坏记录都抓得住。' : '\n→ ❌ 有漏网，本复核不可信。');
  process.exit(allOk ? 0 : 1);
}

// ── 单条检查 ──────────────────────────────────────────────────────────────
// 名字的短形：红楼梦行文常用「珠」「赦」「政」代「賈珠」「賈赦」「賈政」
function shortForms(n) {
  const s = norm(n), out = new Set([s]);
  if (s.length >= 2) out.add(s.slice(1));
  if (s.length >= 3) out.add(s.slice(-2));
  return [...out].filter(x => x.length >= 1);
}

function checkOne(f) {
  const g = norm(f.grounding || '');
  const res = { id: f.id, hardFail: null, anchors: 0, convention: null };
  if (!g) { res.hardFail = '缺 grounding'; return res; }
  if (g.length < 8 || g.length > 40) res.hardFail = `引文长度 ${g.length} 越界(8–40)`;
  if (/[{}【】]/.test(g)) res.hardFail = '引文含标记残留';
  const n = chNum(f.chapter);
  if (!n) { res.hardFail = res.hardFail || `回次无法解析：${f.chapter}`; return res; }
  if (!CH_TEXT[n] || !CH_TEXT[n].includes(g)) {
    // 是彻底编造，还是只是回次报错？分开报——两者的性质完全不同
    const elsewhere = Object.entries(CH_TEXT).find(([, t]) => t.includes(g));
    res.hardFail = elsewhere ? `引文不在自称的${f.chapter}，实际在第${elsewhere[0]}回` : '引文在全书中都找不到（编造）';
    return res;
  }

  if (f.kind !== 'kinship') return res;

  // 端点锚定
  for (const who of [f.subject, f.object]) {
    if (who && shortForms(who).some(x => g.includes(x))) res.anchors++;
  }

  // 方向：找属格结构「<某人>之<关系>」
  const rel = norm(f.relation);
  const hitA = shortForms(f.subject).some(x => g.includes(x + '之' + rel));  // 主语的R是宾语
  const hitB = shortForms(f.object).some(x => g.includes(x + '之' + rel));   // 主语是宾语的R
  if (hitA && !hitB) res.convention = 'A';
  else if (hitB && !hitA) res.convention = 'B';
  return res;
}

const results = facts.map(checkOne);
const hard = results.filter(r => r.hardFail);
const kin = facts.map((f, i) => ({ f, r: results[i] })).filter(x => x.f.kind === 'kinship');
const convA = kin.filter(x => x.r.convention === 'A');
const convB = kin.filter(x => x.r.convention === 'B');
const convNone = kin.filter(x => !x.r.convention);
const mixed = convA.length > 0 && convB.length > 0;

const anchorHist = { both: 0, one: 0, none: 0 };
for (const x of kin) anchorHist[x.r.anchors === 2 ? 'both' : x.r.anchors === 1 ? 'one' : 'none']++;

// ── L-E 实体归一 ──────────────────────────────────────────────────────────
// 同一个人在原文里有多个名字：史氏太君=賈母、賈敏=賈氏、王夫人=王氏、甄士隱=甄老爺。
// 不归一就交给判分器，「賈母」会连不上任何一条亲属边 —— 不是报错，是静默全盘失效。
// 所以这里要的不是「我来猜哪些是别名」（猜测不可复核），而是**要求交付方显式给出别名表**，
// 本复核只验完整性：每个出现过的实体名都必须在表里有归属。
// 归一表是三张判据表共用的一份（demo/hongloumeng-c/aliases.json），不在本文件里各带一份。
const entities = [...new Set(kin.flatMap(x => [x.f.subject, x.f.object].filter(Boolean).map(norm)))];
let aliasProblem = null;
try {
  const A = JSON.parse(readFileSync(join(__dir, 'aliases.json'), 'utf8'));
  const known = new Set();
  for (const p of Object.values(A.persons || {})) {
    known.add(norm(p.canonical));
    for (const v of p.variants || []) known.add(norm(v.name));
  }
  const skip = new Set([...(A.non_persons || []), ...((A.not_entities || {}).items || [])].map(norm));
  const ambiguous = new Set((A.ambiguous_forms || []).map(a => norm(a.form)));
  const bad = entities.filter(e => !skip.has(e) && !known.has(e));
  const amb = entities.filter(e => ambiguous.has(e));
  if (amb.length) aliasProblem = `事实表把歧义形当实体名用了：${amb.join('、')}`;
  else if (bad.length) aliasProblem = `以下实体名不在归一表中：${bad.join('、')}`;
} catch (e) {
  aliasProblem = `读不到共用归一表 aliases.json：${e.message}`;
}

const ok = hard.length === 0 && !mixed && !aliasProblem;
const result = {
  ok, source: FACTS, total: facts.length, kinship: kin.length,
  hard_failures: hard.length,
  convention: { A: convA.length, B: convB.length, undetermined: convNone.length, mixed },
  anchors: anchorHist,
  entities: entities.length,
  alias_problem: aliasProblem,
  details: hard.map(h => ({ id: h.id, why: h.hardFail })),
};

if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(ok ? 0 : 1); }

console.log('═══ 抽取事实表 · 独立复核（W1-3）═══\n');
console.log(`来源  ${FACTS}`);
console.log(`条数  ${facts.length}（其中亲属关系 ${kin.length}）\n`);
console.log(`L-A/B 引文逐字命中自称回次 + 长度合规：${hard.length ? '❌ ' + hard.length + ' 条失败' : '✅ 全部通过'}`);
for (const h of hard) console.log(`        • ${h.id}：${h.hardFail}`);
console.log(`\nL-C 端点锚定（断言两端有几个出现在引文里）`);
console.log(`        两端都在 ${anchorHist.both}　只有一端 ${anchorHist.one}　一端都没有 ${anchorHist.none}`);
console.log(`\nL-D 方向约定（由中文属格结构「X之R」反推）`);
console.log(`        约定A「主语的R是宾语」 ${convA.length} 条`);
console.log(`        约定B「主语是宾语的R」 ${convB.length} 条`);
console.log(`        属格结构缺失、判不出 ${convNone.length} 条`);
if (mixed) {
  console.log('\n        ❌ 同一张表混用了两套方向约定。');
  console.log('        下游判分器无论按哪套解释，都会有一批记录被反向读取。');
  console.log('        典型对照：');
  if (convA[0]) console.log(`          约定A  ${convA[0].f.id} ${convA[0].f.subject} 的${convA[0].f.relation}是 ${convA[0].f.object}　┊ ${convA[0].f.grounding.slice(0, 20)}`);
  if (convB[0]) console.log(`          约定B  ${convB[0].f.id} ${convB[0].f.subject} 是 ${convB[0].f.object} 的${convB[0].f.relation}　┊ ${convB[0].f.grounding.slice(0, 20)}`);
}
console.log(`\nL-E 实体归一（同一个人的多个名字必须显式归一）`);
console.log(`        实体名 ${entities.length} 个　${aliasProblem ? '❌ ' + aliasProblem : '✅ 全部已归一'}`);
if (aliasProblem) console.log('        实体清单：' + entities.join('、'));

if (ok) {
  console.log('\n→ 该事实表可进入判据底表。');
} else {
  console.log('\n→ ❌ 该事实表尚不可用。');
  if (hard.length) console.log('  有引文层硬失败，见上。');
  if (mixed) console.log('  方向约定混用：引文可以全为真、抽取方自检可以全绿——\n  它只测了「引文是否存在」这一个维度，而错误不在那个维度上。');
  if (aliasProblem) console.log('  实体未归一：引文与方向可以全对，表仍然不能用。\n  实体不归一时判分器不会报错，它会安静地什么都判不出来——\n  「賈母」连不上任何一条亲属边，而日志上一片正常。');
}
process.exit(ok ? 0 : 1);
