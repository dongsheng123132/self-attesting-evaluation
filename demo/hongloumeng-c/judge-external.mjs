#!/usr/bin/env node
/**
 * judge-external.mjs — 用同一套判据判一段外部续写文本
 *
 * 这个入口现在只管三件事：读哪份文本、怎么分回、繁简怎么归一。
 * **判决语义一个字都不在这里**，在 matcher.mjs。
 *
 * 原来的理由仍然成立——繁简归一不能塞进主线，否则会改变前八十回的匹配、
 * 等于为了判别人而动校准基线。但此前为此复制了一整套匹配代码，
 * 代价是同一类错误犯了三次（漏 also_requires、漏分句边界、主文件内部又抄了一遍）。
 * 现在归一是 matcher 的一个参数，隔离仍在，复制没了。
 *
 * 代价要说清楚：共用之后，matcher 的 bug 会同时打中两份文本。
 * 好处是两边错得一样、判决仍可比；坏处是不会再有「两边不一致」这个免费的报警器。
 * 所以改 matcher 必跑 C0 —— 那才是现在唯一的报警器。
 *
 * 判什么：只判「后四十回未兑现的那些条」——续编是接着第一二〇回往下写的，
 * 已经在后四十回兑现的断言不需要它再兑现一次。
 *
 * 诚实前提（读结论前必须知道）：
 *   1. 续编是**照着判词写的**（回目直接用判词原句），所以「兑现」几乎是必然，
 *      证据强度极弱。真正有信息量的是它**仍然没接上**的那些条。
 *   2. 繁简映射表手工建，遗漏的表现是漏判而非错判——偏向低估续编。
 *   3. 本判分器是关键词级检索，判「文本里有没有」，不判写得好不好。
 *
 * 用法：node judge-external.mjs [--file <路径>] [--label <名字>] [--json]
 *   不带 --file 时判同事公开的续编（默认值不变，此前的结论仍可原样复跑）。
 *
 * 为什么要收 --file：W4-1 要拿我方续写与同事续编同台比。同台的前提是**同一个入口**——
 * 本文件头一版就栽在这上面：漏实现主判分器的 also_requires，两个入口匹配语义不一致，
 * 判决当场不可比。为我方文本另写一个入口会把那个错误再犯一遍，只是这次对自己有利。
 */
import { readFileSync } from 'node:fs';
import { stripHeading } from './corpus.mjs';
import { createMatcher } from './matcher.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const argOf = k => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const relFile = argOf('--file') || 'external/xubian-rewrite.md';
const TARGET = isAbsolute(relFile) ? relFile : join(__dir, relFile);
const LABEL = argOf('--label') || relFile;

const spec = JSON.parse(readFileSync(join(__dir, 'judge-spec.json'), 'utf8'));
const aliasTable = JSON.parse(readFileSync(join(__dir, 'aliases.json'), 'utf8'));
const t2s = JSON.parse(readFileSync(join(__dir, 't2s-map.json'), 'utf8')).pairs;
const raw = readFileSync(TARGET, 'utf8');

const conv = s => [...String(s)].map(c => t2s[c] || c).join('');
const norm = s => String(s).replace(/[\s　]/g, '');
// 分回：续编用「第一百二十一回」这类写法
const CN = '零一二三四五六七八九十百';
function splitXubian(text) {
  const lines = text.split(/\r?\n/);
  const marks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^第一百二十([一二三四五])回/);
    if (m) marks.push({ i, n: 120 + CN.indexOf(m[1]) });
  }
  // 目录里也会出现回目行，取每个回次**最后一次**出现处作为正文起点
  const last = new Map();
  for (const m of marks) last.set(m.n, m.i);
  const starts = [...last.entries()].sort((a, b) => a[0] - b[0]);
  return starts.map(([n, i], k) => {
    const seg = lines.slice(i, k + 1 < starts.length ? starts[k + 1][1] : lines.length);
    // 与主判分器共用同一个剥头实现：回目是内容摘要，拿它证明「事情发生了」等于拿目录证正文。
    // 两个入口的匹配语义必须一致，否则跨文本判决不可比（本文件第一版已经栽过一次）。
    return { n, text: seg.join('\n'), body: stripHeading(seg).join('\n') };
  });
}

const chapters = splitXubian(raw);

// 匹配语义不在本文件里。本文件只负责三件事：读哪份文本、怎么分回、繁简怎么归一。
// 判决语义只有一份（matcher.mjs），繁简归一降级成它的一个参数——
// 而不是反过来为了归一复制一整套匹配代码。此前那样做，同一类错误犯了三次。
const { scan } = createMatcher({ spec, aliasTable, chapters, transform: conv });
const hits = (p, patterns, useSpeech) => scan(p, patterns, -Infinity, Infinity, useSpeech);

// 只判后四十回未兑现的那些条
const prior = JSON.parse(readFileSync(join(__dir, 'REPORT.md'), 'utf8').includes('x') ? '{}' : '{}');
const targets = spec.predicates.filter(p => p.role === 'case' && !p.experimental
  && (p.kind === 'event' || p.kind === 'status'));

const results = targets.map(p => {
  const found = hits(p, p.any_of || [], p.kind === 'status');
  const against = p.contradicts ? hits(p, p.contradicts, p.kind === 'status') : [];
  const verdict = found.length && against.length ? 'BOTH' : against.length ? 'CONTRADICTED'
    : found.length ? 'FULFILLED' : 'NOT_FOUND';
  return { id: p.id, claim: p.claim, verdict, chapters: found.map(h => h.chapter), evidence: found.slice(0, 2), against };
});

if (asJson) { console.log(JSON.stringify({ source: LABEL, chars: norm(raw).length, chapters: chapters.map(c => c.n), results }, null, 2)); process.exit(0); }

const n = v => results.filter(r => r.verdict === v).length;
console.log('═══ 外部续编判决 · 第 121–125 回 ═══\n');
console.log(`来源  ${LABEL}（${norm(raw).length} 字）`);
console.log(`繁简映射 ${Object.keys(t2s).length} 对，见 t2s-map.json\n`);
for (const r of results) {
  const mark = { FULFILLED: '● 兑现  ', CONTRADICTED: '✖ 违反  ', BOTH: '⚠ 两者皆有', NOT_FOUND: '○ 未见  ' }[r.verdict];
  console.log(`${mark} ${r.id.padEnd(10)} ${r.claim.slice(0, 40)}`);
  if (r.chapters.length) {
    console.log(`    第 ${r.chapters.join('、')} 回`);
    for (const e of r.evidence.slice(0, 1)) console.log(`      「${e.pattern}」┊ …${e.evidence}…`);
  }
}
console.log(`\n兑现 ${n('FULFILLED')}　违反 ${n('CONTRADICTED')}　未见 ${n('NOT_FOUND')}　共 ${results.length}`);
console.log('\n⚠ 读结论前必读：续编是照着判词写的（回目直接用判词原句），「兑现」几乎必然，证据强度极弱。');
console.log('  真正有信息量的是它仍然没接上的那些条。繁简映射表手工建，遗漏表现为漏判，偏向低估续编。');
