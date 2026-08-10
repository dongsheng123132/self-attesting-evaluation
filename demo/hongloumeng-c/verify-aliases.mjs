#!/usr/bin/env node
/**
 * verify-aliases.mjs — 实体归一表的守门人（W1-4）
 *
 * 归一表是判据底表里最危险的一张：它错了不会红，只会让判分器安静地什么都判不出来。
 * 所以它比前几张表多担一条责任——**覆盖率**：三张判据表里出现过的每一个人名，
 * 都必须在这里有归属。少一个，那个人在判分器眼里就是个陌生人。
 *
 * 四层检查：
 *   A 规则类别名：机械可判（变体 = 规范名去掉声明过的姓氏前缀）
 *   B 引文类别名：引文逐字命中其自称的那一回
 *   C 无冲突：一个名字不许映射到两个人
 *   D 覆盖：panci-spec / zhipi-spec / 事实表里的人名全部有归属，
 *     且 ambiguous_forms 里的歧义形不许被任何一张表当作实体名使用
 *
 * 用法：node verify-aliases.mjs [--json] [--selftest]
 * 退出码：0=可用  1=不可用
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitChapters } from './corpus.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const SELFTEST = argv.includes('--selftest');

const norm = s => String(s).replace(/[\s　]/g, '');
const CN = '零一二三四五六七八九十';
function chNum(t) {
  const m = String(t).match(/^第(.+)回$/); if (!m) return null;
  const s = m[1].replace(/[〇○]/g, '零');   // 底本混用 零／〇／○，先归一
  let v = 0;
  // 逐字写法：第一〇九回 / 第一二〇回（100 回以后本底本用这种）
  if (s.length === 3 && [...s].every(c => CN.indexOf(c) >= 0 && CN.indexOf(c) <= 9)) {
    v = CN.indexOf(s[0]) * 100 + CN.indexOf(s[1]) * 10 + CN.indexOf(s[2]);
    return v > 0 ? v : null;
  }
  if (s.includes('十')) { const [a, b] = s.split('十'); v = (a ? CN.indexOf(a) : 1) * 10 + (b ? CN.indexOf(b) : 0); }
  else v = CN.indexOf(s);
  return v > 0 ? v : null;
}

const A = JSON.parse(readFileSync(join(__dir, 'aliases.json'), 'utf8'));
const chapters = splitChapters(readFileSync(join(__dir, 'corpus/wikisource-honglou-120.txt'), 'utf8'), 120);
const CH = {}; for (const c of chapters) CH[c.n] = norm(c.text);

function quoteOk(g, chapter) {
  const n = chNum(chapter); if (!n || !CH[n]) return `回次无法解析或不存在：${chapter}`;
  if (!CH[n].includes(norm(g))) {
    const other = Object.entries(CH).find(([, t]) => t.includes(norm(g)));
    return other ? `引文不在${chapter}，实际在第${other[0]}回` : '引文在全书中找不到（编造）';
  }
  return null;
}

// ── 反向用例 ──────────────────────────────────────────────────────────────
if (SELFTEST) {
  const probes = [
    { name: '编造的别名引文', ok: quoteOk('原來這襲人本名紫鵑，賈母所賜', '第三回') !== null },
    { name: '真引文但回次报错', ok: quoteOk('因取名為李紈，字宮裁', '第三回') !== null },
    { name: '真引文且回次正确应放行', ok: quoteOk('因取名為李紈，字宮裁', '第四回') === null },
    {
      name: '规则类别名的非法用法（前缀不是声明过的姓氏）',
      ok: !ruleOk('鳳姐', '王熙鳳'),
    },
    { name: '规则类别名的合法用法', ok: ruleOk('寶玉', '賈寶玉') },
  ];
  console.log('═══ 反向用例：归一表守门人有没有判别力 ═══\n');
  let all = true;
  for (const p of probes) { if (!p.ok) all = false; console.log(`  ${p.ok ? '✅' : '❌'}  ${p.name}`); }
  console.log(all ? '\n→ 有判别力。' : '\n→ ❌ 无判别力。');
  process.exit(all ? 0 : 1);
}

function ruleOk(variant, canonical) {
  const v = norm(variant), c = norm(canonical);
  if (!c.endsWith(v) || c === v) return false;
  const prefix = c.slice(0, c.length - v.length);
  return (A.rules.surname_prefix.surnames || []).includes(prefix);
}

const problems = [];
const stats = { persons: 0, variants: 0, rule: 0, quote: 0, inference: 0, pending: 0 };
const nameToId = new Map();

for (const [id, p] of Object.entries(A.persons)) {
  stats.persons++;
  const names = [p.canonical, ...(p.variants || []).map(v => v.name)];
  for (const n of names) {
    const k = norm(n);
    if (nameToId.has(k) && nameToId.get(k) !== id)
      problems.push(`名字冲突：「${n}」同时映射到 ${nameToId.get(k)} 和 ${id}`);
    nameToId.set(k, id);
  }
  for (const v of p.variants || []) {
    stats.variants++;
    if (v.kind === 'rule') {
      stats.rule++;
      if (!ruleOk(v.name, p.canonical))
        problems.push(`${id}：「${v.name}」声称由 surname_prefix 规则导出，但规则不成立`);
    } else if (v.kind === 'quote') {
      stats.quote++;
      const e = quoteOk(v.grounding, v.chapter);
      if (e) problems.push(`${id}「${v.name}」：${e}`);
    } else if (v.kind === 'inference') {
      stats.inference++;
      const gs = v.groundings || [];
      if (gs.length < 2) problems.push(`${id}「${v.name}」：inference 必须给出 ≥2 条引文，现有 ${gs.length}`);
      for (const g of gs) { const e = quoteOk(g, v.chapter); if (e) problems.push(`${id}「${v.name}」：${e}`); }
      if (!v.reasoning) problems.push(`${id}「${v.name}」：inference 必须写明推断理由`);
    } else problems.push(`${id}「${v.name}」：evidence kind 非法「${v.kind}」`);
  }
  stats.pending += (p.pending || []).length;
}

// ── 覆盖率 ────────────────────────────────────────────────────────────────
function collectEntities() {
  const E = new Set();
  const panci = JSON.parse(readFileSync(join(__dir, 'panci-spec.json'), 'utf8'));
  const zhipi = JSON.parse(readFileSync(join(__dir, 'zhipi-spec.json'), 'utf8'));
  const facts = JSON.parse(readFileSync(join(__dir, 'work/hermes-facts-v2.json'), 'utf8'));
  for (const e of panci.entries) {
    String(e.character).split('/').map(s => s.trim()).filter(x => x && x !== '（全局）').forEach(x => E.add(x));
    for (const a of e.assertions || []) for (const k of ['subject', 'spouse', 'counterparty', 'culprit']) if (a.check?.[k]) E.add(a.check[k]);
  }
  for (const e of zhipi.entries) for (const a of e.assertions || []) for (const k of ['subject', 'spouse', 'to', 'from', 'wife', 'maid']) if (a.check?.[k]) E.add(a.check[k]);
  for (const f of facts.facts) if (f.kind === 'kinship') { E.add(f.subject); E.add(f.object); }
  return [...E].filter(Boolean).map(norm);
}

const used = collectEntities();
const skip = new Set([...(A.non_persons || []), ...((A.not_entities || {}).items || [])].map(norm));
const ambiguous = new Set((A.ambiguous_forms || []).map(a => norm(a.form)));
const unmapped = [], usedAmbiguous = [];
for (const e of used) {
  if (skip.has(e)) continue;
  if (ambiguous.has(e)) { usedAmbiguous.push(e); continue; }
  if (!nameToId.has(e)) unmapped.push(e);
}
if (unmapped.length) problems.push(`以下人名在判据表里被用到，却不在归一表中：${unmapped.join('、')}`);
if (usedAmbiguous.length) problems.push(`以下歧义形被当作实体名使用（禁止）：${usedAmbiguous.join('、')}`);

const ok = problems.length === 0;
const result = { ok, stats, entities_used: used.length, unmapped, used_ambiguous: usedAmbiguous, problems };

if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(ok ? 0 : 1); }

console.log('═══ 实体归一表 · 自校验（W1-4）═══\n');
console.log(`规范人物   ${stats.persons} 人`);
console.log(`别名条目   ${stats.variants}（规则导出 ${stats.rule}　原文佐证 ${stats.quote}　两条以上引文推得 ${stats.inference}）`);
console.log(`待归一     ${stats.pending} 条（原文中找不到等式，显式挂起，不冒充已归一）`);
console.log(`歧义形     ${(A.ambiguous_forms || []).length} 个（禁止用作实体名）`);
console.log(`\n三张判据表用到的实体名 ${used.length} 个`);
if (problems.length) {
  console.log(`\n❌ ${problems.length} 处问题：`);
  for (const p of problems) console.log('  • ' + p);
} else {
  console.log('\n✅ 别名逐条可复核（规则可判 / 引文逐字命中自称回次）、无一名两属、三张表的人名全部有归属。');
}
process.exit(ok ? 0 : 1);
