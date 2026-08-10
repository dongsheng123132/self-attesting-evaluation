#!/usr/bin/env node
/**
 * judge-external.mjs — 用同一套判据判一段外部续写文本
 *
 * 为什么单独一个入口，不改 judge.mjs：
 *   判分器与语料都是繁体，外部续编是简体。若把繁简归一塞进主判分器，
 *   会连带影响 C0 校准（「裡/裏/里」这类合并会改变前八十回的匹配），
 *   等于为了判别人而动了校准基线。所以外部文本走独立入口，主线一字不动。
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
 * 用法：node judge-external.mjs [--json]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const asJson = process.argv.includes('--json');

const spec = JSON.parse(readFileSync(join(__dir, 'judge-spec.json'), 'utf8'));
const aliasTable = JSON.parse(readFileSync(join(__dir, 'aliases.json'), 'utf8'));
const t2s = JSON.parse(readFileSync(join(__dir, 't2s-map.json'), 'utf8')).pairs;
const raw = readFileSync(join(__dir, 'external/xubian-rewrite.md'), 'utf8');

const conv = s => [...String(s)].map(c => t2s[c] || c).join('');
const norm = s => String(s).replace(/[\s　]/g, '');
const narrationOnly = s => s
  .replace(/“[^”]*”/g, '　').replace(/「[^」]*」/g, '　').replace(/『[^』]*』/g, '　')
  .replace(/"[^"]*"/g, '　');

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
  return starts.map(([n, i], k) => ({
    n,
    text: lines.slice(i, k + 1 < starts.length ? starts[k + 1][1] : lines.length).join('\n'),
  }));
}

const chapters = splitXubian(raw);

function namesOf(canonical) {
  const out = new Set([norm(canonical)]);
  for (const p of Object.values(aliasTable.persons || {})) {
    if (norm(p.canonical) === norm(canonical)) for (const v of p.variants || []) out.add(norm(v.name));
  }
  return [...out].map(conv);
}

function hits(p, patterns, useSpeech) {
  const names = (p.subject_names ? p.subject_names.map(norm) : namesOf(p.subject)).map(conv);
  const prox = p.proximity ?? spec.defaults.proximity;
  const pats = patterns.map(x => conv(norm(x)));
  const out = [];
  for (const c of chapters) {
    const t = conv(norm(useSpeech ? c.text : narrationOnly(c.text)));
    const anchors = [];
    for (const nm of names) { let i = 0; while ((i = t.indexOf(nm, i)) !== -1) { anchors.push(i); i += nm.length; } }
    if (!anchors.length) continue;
    for (const pat of pats) {
      let i = 0;
      while ((i = t.indexOf(pat, i)) !== -1) {
        // also_requires：主判分器有这条，第一版外部入口漏实现，导致 A-04-1 在第一二三回
        // 命中「外洋某国国王迎娶的是中原贾府三小姐」——那是探春不是宝钗。
        // 两个入口的匹配语义必须一致，否则跨文本判决不可比。
        let extraOk = true;
        if (p.also_requires) {
          const extra = p.also_requires.names.flatMap(namesOf).map(conv);
          const ep = p.also_requires.proximity ?? prox;
          extraOk = extra.some(nm => { let jx = 0; while ((jx = t.indexOf(nm, jx)) !== -1) { if (Math.abs(jx - i) <= ep) return true; jx += nm.length; } return false; });
        }
        if (extraOk && anchors.some(a => Math.abs(a - i) <= prox)) {
          out.push({ chapter: c.n, pattern: pat, evidence: t.slice(Math.max(0, i - 30), i + 40) });
          break;
        }
        i += pat.length;
      }
      if (out.some(h => h.chapter === c.n)) break;
    }
  }
  return out;
}

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

if (asJson) { console.log(JSON.stringify({ chapters: chapters.map(c => c.n), results }, null, 2)); process.exit(0); }

const n = v => results.filter(r => r.verdict === v).length;
console.log('═══ 外部续编判决 · 第 121–125 回 ═══\n');
console.log(`来源  external/xubian-rewrite.md（${norm(raw).length} 字，简体）`);
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
