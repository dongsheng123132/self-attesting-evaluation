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
// 默认指向**当前**交付版本。此前默认写死 work/hermes-facts.json（第 1 版，已被 v2 取代），
// 于是照文档敲命令的人拿到的是一份「已作废文件的红」，而当前交付是绿的——
// 一个把默认指向陈旧输入的验证器，报的不是被测物的状态，是它自己的路径的状态。
const FACTS = argv.includes('--facts') ? argv[argv.indexOf('--facts') + 1] : join(__dir, 'work/hermes-facts-v2.json');

const norm = s => String(s).replace(/[\s　]/g, '');
const CN = '零一二三四五六七八九十';
const chNum = t => { const m = t.match(/^第(.+)回$/); if (!m) return null; const s = m[1]; let v = 0; if (s.includes('十')) { const [a, b] = s.split('十'); v = (a ? CN.indexOf(a) : 1) * 10 + (b ? CN.indexOf(b) : 0); } else v = CN.indexOf(s); return v > 0 ? v : null; };

const chapters = splitChapters(readFileSync(join(__dir, 'corpus/wikisource-honglou-120.txt'), 'utf8'), 120);
const CH_TEXT = {};
for (const c of chapters) CH_TEXT[c.n] = norm(c.text);

const data = JSON.parse(readFileSync(FACTS, 'utf8'));
let facts = data.facts || [];


// ── 单条检查 ──────────────────────────────────────────────────────────────
// 名字的短形：红楼梦行文常用「珠」「赦」「政」代「賈珠」「賈赦」「賈政」
function shortForms(n) {
  const s = norm(n), out = new Set([s]);
  if (s.length >= 2) out.add(s.slice(1));
  if (s.length >= 3) out.add(s.slice(-2));
  return [...out].filter(x => x.length >= 1);
}

// ── L-D 的召回：名字的别名 + 关系的同义词 ────────────────────────────────────
//
// 收紧 L-D 之后第一次实跑，41 条判「方向未证」。逐条回原文看，头一条就是冤的：
//   K-001「目今你貴東家林公之夫人，即榮府中赦，政二公之…」
//   属格结构明明在（「林公之夫人」），只是检查器认死「林如海」+「之妻」两个字面。
// 把这种算成交付方的错，等于让判据去追字面而不是追事实——正是本轮判词谓词那边
// 已经踩过的坑。所以先补召回再定罪：召回不足时报出来的「未证」里混着自己的漏判。
//
// 别名来自三张判据表共用的 aliases.json（不在本文件里另起一份，那是「各部件各写各的」）。
// 关系同义词表则写在这里并声明其局限：手工列举，遗漏的表现是**误判为未证**，
// 即偏向严格——它会多要求交付方几条，不会放过错误方向。
const ALIASES = (() => { try { return JSON.parse(readFileSync(join(__dir, 'aliases.json'), 'utf8')); } catch { return {}; } })();
const NAME_FORMS = (() => {
  const m = new Map();
  for (const p of Object.values(ALIASES.persons || {})) {
    const all = new Set([norm(p.canonical), ...(p.variants || []).map(v => norm(v.name))]);
    const forms = new Set([...all].flatMap(shortForms));
    for (const k of all) m.set(k, forms);
  }
  return m;
})();
const formsOf = n => [...(NAME_FORMS.get(norm(n)) || new Set(shortForms(n)))];

const REL_SYNONYMS = {
  妻: ['妻', '夫人', '嫡妻', '正室', '妻子', '内人'],
  夫: ['夫', '丈夫', '男人'],
  母: ['母', '生母', '母親', '娘'],
  父: ['父', '生父', '父親', '爹'],
  子: ['子', '兒子', '長子', '次子', '男'],
  女: ['女', '女兒', '小姐'],
  兄: ['兄', '哥哥', '長兄'],
  弟: ['弟', '弟弟', '兄弟'],
  姐: ['姐', '姊', '姐姐', '姊姊'],
  妹: ['妹', '妹妹'],
  孫: ['孫', '孫子'],
  祖父: ['祖父', '祖'],
  侄: ['侄', '姪', '侄兒'],
};
const relForms = r => { const s = norm(r); return REL_SYNONYMS[s] || [s]; };

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
  // 两端一个都不在引文里，这条引文就证不了这条断言——它只是「原文里的一句真话」。
  // 此前这一层只统计不拦截：v2 有 5 条 anchors=0，报告照印，判决照绿。
  // 那正是本仓库反复记的那个形状——**指标印出来了，闸门没接上去**。
  if (res.anchors === 0) res.hardFail = '引文未提及断言的任何一端，证不了这条';

  // 方向：找属格结构「<某人>之<关系>」（名字取别名全形，关系取同义词，属格取 之／的）
  const rels = relForms(f.relation);
  // 属格匹配只认 ≥2 字的名字形。
  // 补召回时把别名展开进来之后，单字形立刻造出假阳性：抽查「声明不可判是否被滥用」时，
  // 「賈寶玉-母-王夫人」被判成方向可证，因为别名链上有个单字形「玉」，而原文那句是
  // **「黛玉之母」**——匹配到的是别人的属格。方向判错比判不出严重得多，
  // 所以这一层宁可少认几条（少认＝落进「未证」，会被要求补，不会被放过）。
  // 端点锚定那一层不加这条限制：那里单字形是有意的（原文用「珠」「赦」「政」代全名）。
  const genitive = (who) => formsOf(who).filter(x => x.length >= 2)
    .some(x => rels.some(r => g.includes(x + '之' + r) || g.includes(x + '的' + r)));
  const hitA = genitive(f.subject);   // 主语的R是宾语
  const hitB = genitive(f.object);    // 主语是宾语的R
  if (hitA && !hitB) res.convention = 'A';
  else if (hitB && !hitA) res.convention = 'B';

  // 交付方可显式声明「本条原文无属格结构、方向不可由文字判定」，
  // 但必须写明依据。声明过的条目不算失败，计数公开，且**不进底表**。
  if (!res.convention && f.direction_unverifiable === true && norm(f.direction_note || '')) {
    res.excluded = true;
  }
  return res;
}

// ── 反向用例 ──────────────────────────────────────────────────────────────
// 注入三类故意造的坏记录，本复核必须三类都抓住。
// 抓不全，说明它跟抽取方的自检一样只会查一个维度。
if (SELFTEST) {
  const probes = [
    { name: '编造引文（原文没有这句）', rec: { id: 'X1', kind: 'kinship', subject: '賈寶玉', relation: '父', object: '賈政', chapter: '第二回', grounding: '賈政乃寶玉之生父，性最嚴正，寶玉見之如鼠見貓' }, expect: 'A' },
    { name: '引文是真的但回次报错', rec: { id: 'X2', kind: 'kinship', subject: '李紈', relation: '妻', object: '賈珠', chapter: '第二回', grounding: '原來這李氏即賈珠之妻' }, expect: 'A' },
    { name: '引文真、回次对，但方向与属格结构相反', rec: { id: 'X3', kind: 'kinship', subject: '賈珠', relation: '妻', object: '李紈', chapter: '第四回', grounding: '原來這李氏即賈珠之妻' }, expect: 'D' },
    // 下面两条针对本轮补上的闸门。它们此前都能一路绿灯走进底表：
    // X4/X5 的引文都是原文逐字真句（分别在第三、二十八回），只是证不了各自那条断言。
    { name: '引文为真但两端一个都没提到（锚定落空）', rec: { id: 'X4', kind: 'kinship', subject: '賈寶玉', relation: '母', object: '王夫人', chapter: '第三回', grounding: '「若論舍親，與尊兄猶系同譜，乃榮公之孫：大內兄現' }, expect: 'A' },
    { name: '引文为真、两端都在，但无属格结构故方向未证', rec: { id: 'X5', kind: 'kinship', subject: '賈寶玉', relation: '姐', object: '賈元春', chapter: '第二十八回', grounding: '姻”等語，所以總遠著寶玉。昨兒見元春所賜的東西，獨他與寶玉一' }, expect: 'DIR' },
  ];
  console.log('═══ 反向用例：本复核能抓住几类坏记录 ═══\n');
  let allOk = true;
  for (const p of probes) {
    const r = checkOne(p.rec);
    // X3 的构造：属格结构说「賈珠之妻＝李紈」，即 subject 应为賈珠、object 應為李紈（约定A）。
    // 若某条被判成约定 B 而多数是 A（或反之），混用检测会红。这里只验能否定出约定。
    // X5 要的是**判不出**并且**没被声明豁免**——即它会落进 unverified_direction 而挡住整表。
    const ok = p.expect === 'A' ? r.hardFail !== null
      : p.expect === 'DIR' ? (r.hardFail === null && r.convention === null && !r.excluded)
        : r.convention !== null;
    if (!ok) allOk = false;
    console.log(`  ${ok ? '✅ 抓住' : '❌ 放过'}  ${p.name}${r.hardFail ? '（' + r.hardFail + '）' : r.convention ? '（判定约定 ' + r.convention + '）' : ''}`);
  }
  // 条数现数不写死：本仓库已记过一次「注释写 43、实跑 53」的账。
  console.log(allOk ? `\n→ ${probes.length} 类坏记录都抓得住。` : '\n→ ❌ 有漏网，本复核不可信。');
  process.exit(allOk ? 0 : 1);
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

// ── L-D 判别力：「判不出」不等于「通过」 ─────────────────────────────────────
//
// 混用检测（mixed）只在 A>0 且 B>0 时才红。于是一张**全部判不出**方向的表，
// 它一声不吭地放行——而方向错正是本轮的主要错误类型，也就是说：
// 这一层最该拦的那种表，恰好是它拦不住的那种。恒绿考题的又一种形态。
//
// 实测：v2 的 47 条亲属记录里 41 条判不出（87%），绿灯建立在「没检查」之上。
//
// 所以判决改成：方向未证的条目**不进底表**。出路有二——
//   ① 换一句带属格结构「X之R」的引文（原文通常找得到）；
//   ② 显式声明 direction_unverifiable + direction_note 写明依据（计数公开，仍不进底表）。
// 两条都不做，就是没被检查过，而没被检查过的东西不能当判据底表用。
const excluded = kin.filter(x => x.r.excluded);
const unverifiedDir = convNone.filter(x => !x.r.excluded);
const usable = kin.length - excluded.length - unverifiedDir.length;

// usable>0 不是拍脑袋的阈值，是退化情形：把每一条都声明成「方向不可判」能让上面每一层都变绿，
// 而底表是空的。一张空表不叫「可进判据底表」，叫没有判据。
const ok = hard.length === 0 && !mixed && !aliasProblem && unverifiedDir.length === 0 && usable > 0;
const result = {
  ok, source: FACTS, total: facts.length, kinship: kin.length,
  hard_failures: hard.length,
  convention: {
    A: convA.length, B: convB.length, undetermined: convNone.length, mixed,
    unverified_direction: unverifiedDir.length,
    declared_unverifiable: excluded.length,
    discriminative_power: kin.length ? +(( convA.length + convB.length) / kin.length).toFixed(3) : null,
  },
  usable_for_judgeset: usable,
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
console.log(`        属格结构缺失、判不出 ${convNone.length} 条`
  + (excluded.length ? `（其中 ${excluded.length} 条已显式声明不可判并写明依据）` : ''));
console.log(`        判别力 ${(result.convention.discriminative_power * 100).toFixed(1)}%`
  + `　——这一层实际检查到的比例。它低的时候，这一层的绿是「没检查」不是「没问题」`);
if (unverifiedDir.length) {
  console.log(`\n        ❌ ${unverifiedDir.length} 条方向未证，且未声明不可判。这些条目不进判据底表。`);
  console.log('        出路二选一：换一句带「X之R」属格结构的引文；或显式写 direction_unverifiable');
  console.log('        + direction_note 说明依据。两条都不做＝没被检查过，而没被检查过的不能当底表。');
  for (const x of unverifiedDir.slice(0, 5)) {
    console.log(`          • ${x.f.id} ${x.f.subject} — ${x.f.relation} — ${x.f.object}　┊ ${String(x.f.grounding).slice(0, 22)}`);
  }
  if (unverifiedDir.length > 5) console.log(`          …其余 ${unverifiedDir.length - 5} 条同类`);
}
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
  console.log(`\n→ 该事实表可进入判据底表（可用 ${usable} 条）。`);
} else {
  console.log(`\n→ ❌ 该事实表尚不可用（当前可用 ${usable} / ${kin.length} 条亲属记录）。`);
  if (hard.length) console.log('  有引文层硬失败，见上。');
  if (unverifiedDir.length) console.log('  方向未证：混用检测只在 A>0 且 B>0 时才红，于是一张全部判不出方向的表\n  会被一声不吭地放行——而方向错正是本轮的主要错误类型。「判不出」不算「通过」。');
  if (mixed) console.log('  方向约定混用：引文可以全为真、抽取方自检可以全绿——\n  它只测了「引文是否存在」这一个维度，而错误不在那个维度上。');
  if (aliasProblem) console.log('  实体未归一：引文与方向可以全对，表仍然不能用。\n  实体不归一时判分器不会报错，它会安静地什么都判不出来——\n  「賈母」连不上任何一条亲属边，而日志上一片正常。');
}
process.exit(ok ? 0 : 1);
