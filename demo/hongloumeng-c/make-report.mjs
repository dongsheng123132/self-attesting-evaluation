#!/usr/bin/env node
/**
 * make-report.mjs — 生成《后四十回判词兑现清单》
 *
 * 为什么是生成器不是手写文档：本仓已记录过一次事故——文档里长期写着
 * 「Conformance 7/7」，实测是 5 通过 2 项 MANUAL。手写的数字会漂，
 * 而且漂了没人知道。这里所有数字都是本次运行现跑出来的。
 *
 * 用法：node make-report.mjs [--out REPORT.md]
 * 退出码：0=生成成功（且 C0 闸门放行）  1=C0 未放行，拒绝出报告
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(__dir, 'REPORT.md');

const spec = JSON.parse(readFileSync(join(__dir, 'judge-spec.json'), 'utf8'));
const cal = JSON.parse(readFileSync(join(__dir, 'c0-calibration.json'), 'utf8'));
const panci = JSON.parse(readFileSync(join(__dir, 'panci-spec.json'), 'utf8'));
const zhipi = JSON.parse(readFileSync(join(__dir, 'zhipi-spec.json'), 'utf8'));

function run(args) {
  try { return { code: 0, out: execFileSync('node', args, { encoding: 'utf8', maxBuffer: 1e8 }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
}

// ── C0 闸门：不绿不出报告 ──────────────────────────────────────────────────
const c0 = run([join(__dir, 'verify-c0.mjs'), '--json']);
const c0r = JSON.parse(c0.out);
if (!c0r.ok) {
  console.error('❌ C0 校准闸门未放行，拒绝生成报告。判分器没资格判别人时，它的判决不该被写成清单。');
  console.error(c0r.problems.map(p => '  • ' + p).join('\n'));
  process.exit(1);
}

const pre = JSON.parse(run([join(__dir, 'judge.mjs'), '--json', '--from', '1', '--to', '80']).out);
const post = JSON.parse(run([join(__dir, 'judge.mjs'), '--json', '--from', '81', '--to', '120']).out);
const byId = new Map(spec.predicates.map(p => [p.id, p]));
const preById = new Map(pre.results.map(r => [r.id, r]));

const cases = post.results.filter(r => byId.get(r.id)?.role === 'case');
const n = v => cases.filter(r => r.verdict === v).length;

// 判据池规模（断言数，不是谓词数）
const assertions = panci.entries.reduce((a, e) => a + (e.assertions || []).length, 0)
  + zhipi.entries.reduce((a, e) => a + (e.assertions || []).length, 0);
const L1 = panci.entries.reduce((a, e) => a + (e.assertions || []).filter(x => x.level === 'L1').length, 0)
  + zhipi.entries.reduce((a, e) => a + (e.assertions || []).filter(x => x.level === 'L1').length, 0);

const L = [];
const w = s => L.push(s);

w('# 《红楼梦》后四十回 · 判词兑现清单');
w('');
w('> 本文件由 `node demo/hongloumeng-c/make-report.mjs` 生成，**所有数字为本次运行现跑**。');
w('> 不要手改此文件——改了下次生成就没了，而且手写的数字会漂。');
w('');
w('## 这是什么');
w('');
w('把曹雪芹自己写下的结局规格（第五回判词与十二支曲）、以及脂砚斋批语记载的佚稿线索，');
w('逐条结构化成机器可判的断言，再逐条到文本里查证。');
w('');
w('**判据不是我们发明的考题**——它来自被判作品的作者本人与其批者。');
w('');
w('## 怎么自己重跑');
w('');
w('```bash');
w('node demo/hongloumeng-c/verify-c0.mjs                    # 校准闸门（不绿则判分器无效）');
w('node demo/hongloumeng-c/judge.mjs --from 81 --to 120     # 后四十回判决');
w('node demo/hongloumeng-c/make-report.mjs                  # 重新生成本文件');
w('```');
w('');
w('## 规模');
w('');
w('| | 数 |');
w('|---|---|');
w(`| 判据池断言总数 | ${assertions}（其中 L1 明确可判 ${L1}） |`);
w(`| 已实现谓词 | ${spec.predicates.length}（判案 ${spec.predicates.filter(p => p.role === 'case').length} · 证召回 ${spec.predicates.filter(p => p.role === 'control').length} · 对照实验 ${spec.predicates.filter(p => p.role === 'experimental').length}） |`);
w(`| C0 校准集 | ${cal.expectations.length} 条（正例 ${c0r.positives} / 负例 ${c0r.negatives}） |`);
w(`| 校准中修改判分器 | ${cal.revision_log.length} 次，逐次留痕 |`);
w('');
w('**覆盖率要说清楚**：判案谓词 ' + spec.predicates.filter(p => p.role === 'case').length + ' 条 / 断言 ' + assertions + ' 条。');
w('这份清单**不是**对后四十回的完整判决，是已实现部分的判决。');
w('');
w('## 判决');
w('');
w(`**兑现 ${n('FULFILLED')}　违反 ${n('CONTRADICTED')}　未交代 ${n('NOT_FOUND')}　共 ${cases.length}**`);
w('');
{
  const ff = cases.filter(r => r.verdict === 'FULFILLED');
  const allCav = ff.filter(r => (r.evidence || []).length && r.evidence.every(e => e.caveat));
  const anyCav = ff.filter(r => (r.evidence || []).some(e => e.caveat) && !allCav.includes(r));
  w(`> **假绿体检**：${ff.length} 条兑现里，${allCav.length} 条的**全部**证据都落在未然/转述语境`
    + `（担心、动念、传闻、回忆旧誓），另有 ${anyCav.length} 条部分证据带此标记但另有干净证据。`);
  w('> 判分器有「不认人物话语」的规则，却没有任何规则挡「未然」——而叙述语里这类语气极多。');
  w('> 这是 W3-2 把假绿抽查扩到全量时抓到的，不是设想。带标记的条目在下面逐条标出，判决一个字未改：');
  w('> 硬删这一族等于拿假绿换假红（实测 B-04-1 在叙述语里找不到更好的证据，删了它会变成「后四十回没写宝玉出家」）。');
}
w('');
w('> 三态的置信度不相等，但**方向与我们最初写的相反**，这一点必须先说。');
w('> 检索谓词要对着被判文本迭代，所以「兑现」的独立性弱——它是被调出来的。');
w('> 但「未交代」同样可以被制造：窄谓词直接产出 NOT_FOUND，且不会报错。');
w('> 本仓两次实证：盲写谓词在目标窗口零命中；A-09-2a 在原文明写「身亡」时仍判未交代。');
w('> 三态中唯一较难人为制造的是「违反」——它要求文本里确实存在反向叙述。');
w('> （这段结论由外部对抗性复核推翻了我们此前的写法，见 handoff/review-by-codex.md 发现 6。）');
w('');

const label = { CONTRADICTED: '违反', NOT_FOUND: '未交代', FULFILLED: '兑现' };
for (const v of ['CONTRADICTED', 'NOT_FOUND', 'FULFILLED']) {
  const rows = cases.filter(r => r.verdict === v);
  if (!rows.length) continue;
  w(`### ${label[v]}（${rows.length}）`);
  w('');
  for (const r of rows) {
    const p = byId.get(r.id);
    w(`**${r.id}　${r.claim}**`);
    if (r.detail) w(`- ${r.detail}`);
    if (r.against_chapters?.length) {
      w(`- 违反证据：第 ${r.against_chapters.join('、')} 回`);
      for (const e of (r.against_evidence || []).slice(0, 1)) w(`  - 「${e.pattern}」┊ …${e.evidence}…`);
    }
    if (r.chapters?.length && v !== 'CONTRADICTED') {
      w(`- 证据：第 ${r.chapters.slice(0, 6).join('、')} 回`);
      for (const e of (r.evidence || []).slice(0, 1)) w(`  - 「${e.pattern}」┊ …${e.evidence}…${e.caveat ? `
  - ⚠ **本条证据落在未然/转述语境**（${e.caveat.why}）：文本里有这个词，但那句话说的可能不是这件事。判决未改，请回原文自行判断。` : ''}`);
    }
    if (r.near_miss?.length) {
      w(`- ⛳ **近失体检**：段级锚定在第 ${r.near_miss.map(x => x.chapter).join('、')} 回找得到，字符级够不着。这是**怀疑标记不是判决**——同段里出现的可能是别人的同类事件，需人工回原文看。`);
      for (const e of r.near_miss.slice(0, 1)) w(`  - 「${e.pattern}」┊ …${e.evidence}…`);
    }
    if (r.spoken_fulfill?.length) w(`- ⚠ 叙述语中未见，但第 ${r.spoken_fulfill.map(x => x.chapter).join('、')} 回的人物话语中有（按规则不计入兑现）`);
    if (r.spoken_only?.length) w(`- ⚠ 另有反向线索出自人物话语，不计入判决`);
    if (v === 'NOT_FOUND') {
      const preR = preById.get(r.id);
      if (preR && preR.verdict !== 'NOT_FOUND') w(`- 召回凭据：本谓词在前八十回被判「${label[preR.verdict]}」，自证找得到`);
      else if (p?.recall_control) w(`- 召回凭据：由 ${p.recall_control} 证明同类事件找得到`);
      else if (p?.recall_unproven) w(`- ⚠ **召回未证**：${p.recall_unproven}`);
      if (preR && preR.verdict === 'FULFILLED') w('- 注：本条已兑现于前八十回，后四十回不需重演');
    }
    w('');
  }
}

w('## 诚实边界');
w('');
w('1. **这不是完整判决。** 判案谓词只覆盖判据池的一部分，其余断言尚未实现检索谓词。');
w('2. **三态置信度不等，且「未交代」并不比「兑现」硬。** 谓词必须对着被判文本迭代才写得出；');
w('   而窄谓词会直接制造「未交代」——本仓实测两次：盲写谓词在目标窗口零命中，');
w('   A-09-2a 在原文明写「不料被孫家揉搓以致身亡」时仍判未交代（第一〇九回）。');
w('   三态中只有「违反」较难人为制造：它要求文本里确实存在反向叙述。');
w('3. **本清单经过一次外部对抗性复核**（codex，只读，结论见 handoff/review-by-codex.md）。');
w('   该复核推翻了三条判决与三条结论强度，已逐条修正并记入 revision_log rev13–16。');
w('4. **判分器是关键词级检索，不是理解。** 它只判「文本里有没有」，不判「写得好不好」。');
w('5. **底本单一。** 判决基于 zh.wikisource 一百二十回本；异文已记录处见 panci-spec 的 variants_observed。');
w('6. **第五回被排除**在证据之外——判词就在第五回，拿它当兑现证据是用规格证明规格。');
w('7. **每条「未交代」都带近失体检。** 段级锚定找得到而字符级够不着的，标为 ⛳ 疑似锚定漏判。');
w('   它是怀疑标记不是判决——本轮 4 条标记中，迎春第一〇九回那条是真漏判（原文明写「身亡」），');
w('   李纨等几条是同段里别人的死，属误报。设这个标记的理由是：外部复核曾抓到一条');
w('   挂着合法召回凭据、闸门全绿、判决却错的谓词。让漏判现形，比假装没有强。');
w('8. **兑现只认叙述语。** 红楼梦的伏笔在字面上就是人物亲口说出后来会发生的事，');
w('   采信人物话语会把全书伏笔一律判成已兑现。被规则挡掉的转述证据均单列在上，未隐藏。');
w('');
w('## 判分器改过几次，改了什么');
w('');
w('校准过程中的每一次修改都留了痕，**包括那些让我们自己难堪的**：');
w('');
for (const r of cal.revision_log) {
  w(`- **rev${r.rev}**（${r.kind}）${r.symptom}`);
  if (r.evidence) w(`  - 现场：${r.evidence}`);
  if (r.fix) w(`  - 修法：${r.fix}`);
}
w('');
w('---');
w('');
w('_本文件由 make-report.mjs 生成。C0 闸门未放行时本脚本拒绝出报告——');
w('判分器没资格判别人时，它的判决不该被写成清单。_');

writeFileSync(OUT, L.join('\n') + '\n');
console.log(`✅ 已生成 ${OUT}`);
console.log(`   判决：兑现 ${n('FULFILLED')}　违反 ${n('CONTRADICTED')}　未交代 ${n('NOT_FOUND')}　共 ${cases.length}`);
console.log(`   C0：正例 ${c0r.positives} / 负例 ${c0r.negatives}，修改留痕 ${cal.revision_log.length} 次`);
