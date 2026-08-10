#!/usr/bin/env node
/**
 * verify-c0.mjs — C0 校准闸门（judge 的准入检查）
 *
 * 把判分器当黑箱：起子进程跑 judge.mjs --json，只看它的输出，不 import 它的内部函数。
 * 理由：闸门若跟被测对象共享实现，被测对象的 bug 会同时污染闸门。
 *
 * 判据：
 *   C0.1 召回 —— 前八十回内确已兑现的断言必须全部检出
 *   C0.2 误报 —— 前八十回内尚未兑现的断言必须一条都不检出
 *   C0.3 判别力 —— 正例与负例都必须非空。只有正例的闸门是恒绿的：
 *        把谓词放到最松，召回必然满分，而闸门看不出任何问题。
 *   C0.4 覆盖 —— judge-spec 里的每条谓词都要在校准集里有预期，不许有未被校准的谓词偷偷上岗
 *   C0.7 单一实现 —— 判分入口不许自己写匹配循环，必须向 matcher.mjs 要。
 *        这条查结构不查行为：行为对得上只说明今天还没漂。实弹验证过会红。
 *
 * 用法：node verify-c0.mjs [--json]
 * 退出码：0=放行  1=不放行（改判分器，不改曹雪芹）
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const asJson = process.argv.includes('--json');

const cal = JSON.parse(readFileSync(join(__dir, 'c0-calibration.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(__dir, 'judge-spec.json'), 'utf8'));

const out = execFileSync('node', [
  join(__dir, 'judge.mjs'), '--json',
  '--from', String(cal.window.from), '--to', String(cal.window.to),
], { encoding: 'utf8', maxBuffer: 1e8 });
const run = JSON.parse(out);
const got = new Map(run.results.map(r => [r.id, r]));

const rows = [], problems = [];
for (const e of cal.expectations) {
  const r = got.get(e.id);
  if (!r) { problems.push(`${e.id}：校准集里有预期，但 judge-spec 里没有这条谓词`); continue; }
  const ok = r.verdict === e.expect;
  if (!ok) {
    problems.push(e.expect !== 'NOT_FOUND'
      ? `${e.id} 漏报：前八十回内确已兑现（${e.why}），判分器却没找到 —— 谓词太窄`
      : `${e.id} 误报：前八十回内尚未兑现（${e.why}），判分器却在第 ${r.chapters.join('、')} 回找到了 —— 谓词太松，多半把伏笔当成了兑现`);
  }
  rows.push({ id: e.id, claim: r.claim, expect: e.expect, got: r.verdict, ok, chapters: r.chapters });
}

// C0.3 判别力
const pos = cal.expectations.filter(e => e.expect !== 'NOT_FOUND').length;
const neg = cal.expectations.filter(e => e.expect === 'NOT_FOUND').length;
if (pos === 0) problems.push('校准集没有正例，无法证明判分器找得到东西');
if (neg === 0) problems.push('校准集没有负例，闸门恒绿：把谓词放到最松也能满分');

// C0.4 覆盖
const covered = new Set(cal.expectations.map(e => e.id));
const uncalibrated = spec.predicates.map(p => p.id).filter(id => !covered.has(id));
if (uncalibrated.length) problems.push(`以下谓词未经校准就上岗：${uncalibrated.join('、')}`);

// C0.5 复合谓词的每条腿都要单独校准
//
// 实测教训：order 类谓词 A-13-3 在前八十回里前一条腿就断了（贾兰没中举），
// 于是后一条腿根本没被测过，却跟着整条谓词一起通过了闸门——
// 到了后四十回才暴露它用裸「死」绑到了旁人身上。
// 这是闸门自身的洞：复合体全绿 ≠ 每个部件都被测过。
// v2（RFC 无，直接由外部对抗性复核逼出来的）：
// 第一版只验 legs_calibrated_by 数组非空、id 在校准集里——那只验了「它说了什么」，
// 没验「它做了什么」。插桩实测：B-04-2 legs_executed={anchor:false,slots:0,of:2}、
// A-13-3 {first:false,then:false}——两条复合谓词的机制在校准窗口内**零执行**，却都过了闸。
//
// 改为覆盖率检查：每条腿必须在校准窗口内真的被执行过。
// 执行不到的（如锚点事件本就发生在目标窗口），必须显式声明 legs_uncovered，
// 并指向一条**同类且腿全执行过**的控制谓词——由它证明这套机制本身跑得通。
const fullyRan = r => {
  const L = r?.legs_executed; if (!L) return false;
  if ('anchor' in L) return L.anchor === true && L.slots === L.of;
  return L.first === true && L.then === true;
};
for (const p of spec.predicates.filter(x => x.kind === 'order' || x.kind === 'configuration')) {
  const r = got.get(p.id);
  if (fullyRan(r)) continue;                       // 腿在校准窗口内真跑满了
  if (!p.legs_uncovered) {
    problems.push(`${p.id}（${p.kind}）在校准窗口内未执行完整：legs_executed=${JSON.stringify(r?.legs_executed)}。`
      + `未执行的部分等于未经校准，须显式声明 legs_uncovered 并挂同类执行对照`);
    continue;
  }
  const ctrls = (p.legs_calibrated_by || []).map(id => ({ id, pred: spec.predicates.find(x => x.id === id), res: got.get(id) }));
  const ok = ctrls.some(c => c.pred?.kind === p.kind && fullyRan(c.res));
  if (!ok) problems.push(`${p.id} 声明 legs_uncovered，但其 legs_calibrated_by 里没有一条「同类且腿全执行过」的控制谓词 —— 那套机制本身有没有跑通仍无从得知`);
}

// C0.6 「未交代」必须有召回凭据
//
// 盲测暴露的不对称：谓词要对着被判文本迭代，所以「兑现」天然可以被做出来；
// 「未交代」信息量更高，但它同样可能是假的——谓词太窄一样产出「未交代」，
// 而且不会红。实测过两次：盲写的远嫁谓词零命中，迎春之死用具体死亡词零命中。
//
// 所以：任何可能给出「未交代」的谓词，都必须先证明自己找得到同类事件。
// 凭据只有两种，都取自校准集，不接受自述：
//   自证 —— 它本人在前八十回被校准为 FULFILLED（那就是它找得到的证据）
//   他证 —— 它声明 recall_control 指向另一条被校准为 FULFILLED 的同类谓词
const calById = new Map(cal.expectations.map(e => [e.id, e]));
for (const p of spec.predicates) {
  if (p.experimental) continue;
  const own = calById.get(p.id);
  if (own && own.expect !== 'NOT_FOUND') continue;          // 自证
  const ctrl = p.recall_control;
  if (!ctrl) {
    // 承认是允许的，隐瞒不是：显式写明「召回未证」及理由即可放行，
    // 但该谓词给出的「未交代」在报告里会被标为低置信。
    if (p.recall_unproven) continue;
    problems.push(`${p.id}：它在校准窗口内被期望为 NOT_FOUND，却既无 recall_control 也未声明 recall_unproven —— 无从判断它给出的「未交代」是文本没写还是谓词太窄`);
    continue;
  }
  const c = calById.get(ctrl);
  if (!c) problems.push(`${p.id}：声明的召回对照 ${ctrl} 不在校准集里`);
  else if (c.expect === 'NOT_FOUND') problems.push(`${p.id}：召回对照 ${ctrl} 自己也被期望为 NOT_FOUND，证明不了任何召回能力`);
}

// C0.7 匹配实现必须只有一份
//
// 这条不是校准，是资格。前六条全部通过、判分器在前八十回上完美，仍然可以出现这种事：
// **判外部文本走的是另一份匹配代码**，于是「两份文本用同一套判据判」这个前提当场失效。
// 实际发生过三次，每次都是独立的漏实现：
//   ① judge-external 漏 also_requires → 把「外洋国王迎娶贾府三小姐」判成宝玉娶宝钗
//   ② judge-external 漏 no_clause_boundary → 「金桂死了，香菱…」判成香菱死
//   ③ judge.mjs 自己的 runOne 又抄了一遍 scan，同一文件里两条路径开始漂
// 三次都不是粗心：**只要匹配语义有两份，它们就会漂**。所以这里查的是结构不是行为——
// 行为对得上只说明今天没漂。
//
// 判法：任何判分入口都不许自己写字符级匹配，必须向 matcher.mjs 要。
// 特征取 `t.indexOf(pat` 这个匹配循环的骨架；换写法能绕过，但那是有意规避，不是失手。
const JUDGE_ENTRIES = ['judge.mjs', 'judge-external.mjs'];
for (const f of JUDGE_ENTRIES) {
  let src;
  try { src = readFileSync(join(__dir, f), 'utf8'); }
  catch { problems.push(`C0.7：判分入口 ${f} 读不到`); continue; }
  if (!/from\s+['"]\.\/matcher\.mjs['"]/.test(src)) {
    problems.push(`C0.7：${f} 没有从 matcher.mjs 取匹配实现 —— 它要么自己写了一份，要么根本没在判`);
  }
  if (/\bt\.indexOf\(pat/.test(src)) {
    problems.push(`C0.7：${f} 里仍有自己的字符级匹配循环（t.indexOf(pat…）。匹配语义只许有一份，两份必漂`);
  }
}

const ok = problems.length === 0;
const result = { ok, window: cal.window, positives: pos, negatives: neg, rows, problems, revisions: cal.revision_log.length };

if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(ok ? 0 : 1); }

console.log(`═══ C0 校准闸门 · 第 ${cal.window.from}–${cal.window.to} 回（排除第 ${cal.window.exclude.join('、')} 回）═══\n`);
console.log('预期      实得      断言');
for (const r of rows) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.expect.padEnd(9)} ${r.got.padEnd(9)} ${r.id}  ${r.claim}${r.got !== 'NOT_FOUND' ? '（第 ' + r.chapters.slice(0, 4).join('、') + ' 回）' : ''}`);
}
console.log(`\n判别力：正例 ${pos} 条 / 负例 ${neg} 条`);
console.log(`校准过程中修改判分器 ${cal.revision_log.length} 次（逐次记录于 c0-calibration.json 的 revision_log）`);
if (problems.length) {
  console.log(`\n❌ ${problems.length} 处不通过：`);
  for (const p of problems) console.log('  • ' + p);
  console.log('\n→ 闸门关闭。改判分器，不改曹雪芹。');
} else {
  console.log('\n✅ 判分器在前八十回上：该找到的全找到，不该找到的一条没找到。');
  console.log('→ 闸门放行：现在它有资格去判别人了。');
}
process.exit(ok ? 0 : 1);
