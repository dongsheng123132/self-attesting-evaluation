#!/usr/bin/env node
/**
 * make-gap-report.mjs — 生成《给续写者的缺口清单》
 *
 * 产出对象不是我们自己，是写续编的人。所以内容取向不同于 REPORT.md：
 * REPORT 回答「后四十回兑现了什么」，本文件回答「还有什么没人接，以及接了怎么算」。
 *
 * 一个必须写在文件里的张力：公布谓词等于公布考题。
 * 照公布不误的理由见文件正文，但同时必须写明「写来通过谓词」≠「兑现判词」。
 *
 * 用法：node make-gap-report.mjs [--out GAP-FOR-CONTINUATION.md]
 * 退出码：0=生成成功（且 C0 放行）  1=C0 未放行，拒绝出报告
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(__dir, 'GAP-FOR-CONTINUATION.md');

const run = a => { try { return execFileSync('node', a, { encoding: 'utf8', maxBuffer: 1e8 }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };

const c0 = JSON.parse(run([join(__dir, 'verify-c0.mjs'), '--json']));
if (!c0.ok) { console.error('❌ C0 未放行，拒绝出缺口清单——判分器没资格判别人时，它列的缺口也不作数。'); process.exit(1); }

const spec = JSON.parse(readFileSync(join(__dir, 'judge-spec.json'), 'utf8'));
const panci = JSON.parse(readFileSync(join(__dir, 'panci-spec.json'), 'utf8'));
const zhipi = JSON.parse(readFileSync(join(__dir, 'zhipi-spec.json'), 'utf8'));
const post = JSON.parse(run([join(__dir, 'judge.mjs'), '--json', '--from', '81', '--to', '120'])).results;
const ext = JSON.parse(run([join(__dir, 'judge-external.mjs'), '--json'])).results;

const byId = new Map(spec.predicates.map(p => [p.id, p]));
const E = new Map(ext.map(r => [r.id, r]));

// 断言出处：从判词表与脂批表里把原文找回来
const src = new Map();
for (const e of panci.entries) for (const a of e.assertions || []) src.set(a.id, { grounding: a.grounding, from: `第五回判词／十二支曲 · ${e.character}` });
for (const e of zhipi.entries) for (const a of e.assertions || []) {
  const b = (e.batches || [])[0];
  src.set(a.id, { grounding: a.grounding, from: b ? `${b.edition}·${b.chapter}（证据等级 ${b.grade}）` : '脂批' });
}

// 三重排除，缺一条这份清单就会误导对方：
//   1) 前八十回已兑现的 —— 不需要谁再写一遍（如宝玉悼晴雯，第七十八回芙蓉女儿诔）
//   2) 判分器已知漏判的 —— 文本写了而我们没判出来，列成缺口等于叫人补已写之事
//   3) 已公开续编已兑现的 —— 那不是缺口
const pre = JSON.parse(run([join(__dir, 'judge.mjs'), '--json', '--from', '1', '--to', '80'])).results;
const preById = new Map(pre.map(r => [r.id, r]));
const gaps = post.filter(r => byId.get(r.id)?.role === 'case' && r.verdict !== 'FULFILLED' && E.has(r.id))
  .filter(r => E.get(r.id).verdict !== 'FULFILLED')
  .filter(r => preById.get(r.id)?.verdict !== 'FULFILLED')
  .filter(r => !byId.get(r.id)?.known_judge_limitation);

const L = []; const w = s => L.push(s);
w('# 给续写者的缺口清单');
w('');
w('> 由 `node demo/hongloumeng-c/make-gap-report.mjs` 生成，数字现跑。');
w('> 面向对象是写续编的人，不是我们自己。');
w('');
w('## 这份清单是什么，不是什么');
w('');
w('**是**：曹雪芹在第五回判词与十二支曲里写下的结局规格、以及脂砚斋批语记载的佚稿线索中，');
w('目前**既没有在后四十回兑现、也没有在已公开的续编（第一二一至一二五回）里出现**的那些条。');
w('');
w('**不是**：文学评价。本判分器只判「文本里有没有」，不判写得好不好。');
w('一条没出现在清单里，只说明机器检索到了相应文字，不代表写得对、更不代表写得好。');
w('');
w('## 一个必须先说的问题：公布谓词等于公布考题');
w('');
w('下面每条都附了「判分器要看到什么才判兑现」——也就是检索谓词。');
w('公布它意味着：照着谓词写，就能让判分器变绿，而判分器对你就失效了。');
w('');
w('我们仍然照公布，理由三条：');
w('');
w('1. 判据本身来自**公开的**判词与脂批，不是我们发明的考题，藏无可藏；');
w('2. 藏着考题去抓人不是我们的立场——判据可公议，才谈得上可信；');
w('3. 但请记住：**「写来通过谓词」不等于「兑现判词」**。谓词只是判词的一个粗糙代理，');
w('   它认的是字面。真正要兑现的是判词那句话本身，那件事机器判不了。');
w('');
w(`## 缺口：${gaps.length} 条`);
w('');
for (const r of gaps) {
  const p = byId.get(r.id);
  const s = src.get(r.id);
  w(`### ${r.id}　${r.claim}`);
  w('');
  if (s) {
    w(`- **出处**：${s.from}`);
    w(`- **原文**：${s.grounding}`);
  }
  w(`- **后四十回**：${r.verdict === 'CONTRADICTED' ? '**违反**（写了相反的）' : '未交代'}`);
  if (r.against_evidence?.length) w(`  - 反向证据：第 ${r.against_chapters.join('、')} 回「${r.against_evidence[0].pattern}」`);
  w(`- **已公开续编（121–125）**：未见`);
  if (p?.kind === 'configuration') {
    w(`- **判分器要看到什么**：在「${(p.anchor.any_of || []).join('／')}」发生的那一回里，`
      + `${(p.require_present || []).join('、')} 同时在场`);
  } else if (p?.kind === 'order') {
    w(`- **判分器要看到什么**：先有「${(p.first.any_of || []).join('／')}」（主语 ${p.first.subject}），`
      + `后有「${(p.then.any_of || []).join('／')}」（主语 ${p.then.subject}）`);
  } else {
    w(`- **判分器要看到什么**：叙述语中，「${p.subject}」附近 ${p.proximity ?? 120} 字内出现 `
      + `「${(p.any_of || []).join('／')}」之一`);
  }
  if (p?.recall_unproven) w(`- ⚠ 本条谓词的召回能力未经证明：${p.recall_unproven}`);
  w('');
}

w('## 判分器的已知局限（请据此打折）');
w('');
w('1. **只认叙述语**。人物口中说的不算——因为红楼梦的伏笔在字面上就等于兑现，');
w('   采信人物话语会把全书伏笔一律判成已兑现。所以借人物之口交代的，机器看不见。');
w('2. **靠主语名邻近绑定**。整段不出现人名时会漏判：实测第一〇九回「可怜一位如花似月之女，');
w('   結褵年餘，不料被孫家揉搓以致身亡」——整句无「迎春」二字，我们最初就判漏了，');
w('   是外部复核指出来的。');
w('3. **跨正字法靠手工映射表**（81 对，见 `t2s-map.json`）。遗漏的表现是漏判而非误报，');
w('   即**偏向低估续编**。若你认为某条明明写了却被判未见，多半是映射或谓词的问题，欢迎指出。');
w('4. **只公开了 5 回**。若其余章回已写，本清单相应条目可能已被兑现，重跑即可更新。');
w('');
w('## 怎么反驳我们');
w('');
w('```bash');
w('node demo/hongloumeng-c/verify-c0.mjs        # 判分器有没有资格判（不绿则以下全部作废）');
w('node demo/hongloumeng-c/judge-external.mjs   # 对已公开续编的逐条判决与证据');
w('node demo/hongloumeng-c/make-gap-report.mjs  # 重新生成本文件');
w('```');
w('');
w('判分器在校准过程中被改过 ' + c0.revisions + ' 次，每次改了什么、因为撞见了哪句原文，');
w('都记在 `c0-calibration.json` 的 `revision_log` 里——包括让我们自己难堪的那些。');
w('');
w('---');
w('');
w('_C0 校准闸门未放行时本脚本拒绝生成。判分器没资格判别人时，它列的缺口也不作数。_');

writeFileSync(OUT, L.join('\n') + '\n');
console.log(`✅ 已生成 ${OUT}`);
console.log(`   缺口 ${gaps.length} 条（后四十回未兑现 且 已公开续编亦未见）`);
