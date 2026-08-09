#!/usr/bin/env node
// verify-observe-text.mjs — 本象 v0.1 文本观察验证器
//
// 规矩同 verify-benxiang.mjs：判据只取自实际行为，可重复跑。
// 本文件存在的理由很具体：2026-08-09 一个会话里「找跨行短语」这件事错了两次
// （collate.mjs 的 D1、extract-instances.mjs 的 UC31）。经验写下来不算数，
// 要挂一个**被违反时会变红**的验证器——否则那是恒绿考题（学堂判据 X2.x）。
// 所以 T2/T3/T4 是核心反向用例：谁把逐行匹配改回来，它们立刻红。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeText, locate, SPEC } from './observe-text.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
const t = (id, desc, fn) => {
  try { const r = fn(); results.push({ id, desc, ok: r === true, detail: r === true ? '' : String(r) }); }
  catch (e) { results.push({ id, desc, ok: false, detail: 'EXCEPTION: ' + e.message }); }
};

// ───── T1 独立性：接口上不给自证留口子 ─────
t('T1.1', 'observeText() 拒绝第三个参数——不许塞进「你觉得里面有什么」', () => {
  try { observeText('abc', {}, /abc/); return '居然接受了第三个参数，观察器已可被塞入预期'; }
  catch (e) { return /不得接收任何预期值/.test(e.message) || `抛错但理由不对: ${e.message}`; }
});
t('T1.2', '观察结果里不含任何判断字段（ok/pass/verdict/valid/found）', () => {
  const o = observeText('hello world');
  const bad = JSON.stringify(o).match(/"(ok|pass|passed|verdict|valid|success|found)"/g);
  return !bad || `观察结果里混进了判断字段: ${bad.join(',')}`;
});
t('T1.3', 'locate() 拒绝非观察结果作为第一参数——「找」必须建立在「看」之上', () => {
  try { locate('一段裸字符串', /a/); return '居然接受了裸字符串，跳过了观察这一步'; }
  catch (e) { return /observeText 的产物/.test(e.message) || `抛错但理由不对: ${e.message}`; }
});

// ───── T2 反向核心：跨行折断的短语必须能被找到 ─────
// 谁把实现改回逐行匹配，这三条立刻变红。这正是本验证器存在的全部理由。
t('T2.1', '【反向】短语被折行拆开时仍能命中（collate.mjs D1 的原病）', () => {
  const o = observeText('Love, yes. Word known to all\nmen. Amor vero');
  const h = locate(o, /Love, yes\. Word known to all men/);
  return h.length === 1 || `折行短语漏了：命中 ${h.length} 次，应为 1`;
});
t('T2.2', '【反向】短语被折行拆开时仍能命中（extract-instances UC31 的原病）', () => {
  const o = observeText('the adventure of the old\nRussian woman, and the singular');
  const h = locate(o, /old Russian woman/);
  return h.length === 1 || `折行短语漏了：命中 ${h.length} 次，应为 1`;
});
t('T2.3', '【反向】连续多个空白（换行+缩进）折叠成单空格，不产生额外空隙', () => {
  const o = observeText('word known to all\n\n      men');
  const h = locate(o, /known to all men/);
  return h.length === 1 || `多重空白未折叠：命中 ${h.length} 次，应为 1`;
});

// ───── T3 反向：排版标记不得造成假阴性 ─────
t('T3.1', '【反向】Gutenberg 斜体下划线包裹的词仍能命中（UC17 的原病）', () => {
  const o = observeText('that of the cutter _Alicia_, which sailed');
  const h = locate(o, /cutter Alicia/);
  return h.length === 1 || `下划线导致漏报：命中 ${h.length} 次，应为 1`;
});
t('T3.2', '【反向】下划线跨行且在词中间时仍能命中', () => {
  const o = observeText('the barque _Sophy\nAnderson_ was lost');
  const h = locate(o, /Sophy Anderson/);
  return h.length === 1 || `命中 ${h.length} 次，应为 1`;
});
t('T3.3', 'dropChars 可关闭——不丢下划线时应当找不到（证明 T3.1 是下划线的功劳，不是碰巧）', () => {
  const o = observeText('the cutter _Alicia_', { dropChars: '' });
  const h = locate(o, /cutter Alicia/);
  return h.length === 0 || `关闭 dropChars 后仍命中 ${h.length} 次，说明 T3.1 并不检验它自称检验的东西`;
});

// ───── T4 行号映射必须准 ─────
t('T4.1', '命中行号 = 短语起始所在的原文行号', () => {
  const o = observeText('line one\nline two\nTARGET here\nline four');
  const h = locate(o, /TARGET/);
  return (h[0] && h[0].line === 3) || `行号错：得到 ${h[0] && h[0].line}，应为 3`;
});
t('T4.2', '【反向】跨行短语的行号取起始行，不是结束行', () => {
  const o = observeText('a\nb\nthe old\nRussian woman\nc');
  const h = locate(o, /old Russian woman/);
  return (h[0] && h[0].line === 3) || `跨行短语行号错：得到 ${h[0] && h[0].line}，应为 3（起始行）`;
});
t('T4.3', '【反向】折叠掉的空白不吞行号——文件末行号等于真实行数', () => {
  const o = observeText('a\n\n\nb\n');
  return o.properties.lines === 5 || `行数错：得到 ${o.properties.lines}，应为 5`;
});

// ───── T5 边界与退化 ─────
t('T5.1', '【反向】找不到时返回空数组，不抛错也不返回 null', () => {
  const h = locate(observeText('nothing here'), /absolutely-not-present/);
  return (Array.isArray(h) && h.length === 0) || `返回了 ${JSON.stringify(h)}`;
});
t('T5.2', '空文本可被观察，不炸', () => {
  const o = observeText('');
  return o.norm === '' && o.properties.norm_chars === 0 || `空文本观察异常: ${JSON.stringify(o.properties)}`;
});
t('T5.3', '【反向】非字符串输入必须抛错，不许静默转成 "[object Object]" 去搜', () => {
  try { observeText({ a: 1 }); return '居然接受了对象，会静默搜索 [object Object]'; }
  catch (e) { return /只观察字符串/.test(e.message) || `抛错但理由不对: ${e.message}`; }
});
t('T5.4', '同一模式的多处出现全部返回，不止第一处', () => {
  const o = observeText('x TARGET y\nTARGET z\nq TARGET');
  return locate(o, /TARGET/).length === 3 || `多处命中丢失：得到 ${locate(o, /TARGET/).length}，应为 3`;
});
t('T5.5', '引语截断不越界（命中在文本开头时不产生负索引切片）', () => {
  const o = observeText('TARGET at the very beginning of the text');
  const h = locate(o, /TARGET/, { context: 500 });
  return h[0].quote.startsWith('TARGET') || `引语异常: ${JSON.stringify(h[0].quote)}`;
});

// ───── T6 调用方确实用上了这个部件（装了不用等于没装）─────
// 这条第一版写成了 `() => true` ——恒真的考题，正是学堂判据禁止的那种。
// 现在它读盘：既要求两个调用方 import 本部件，也要求它们不再各自实现规范化。
const CALLERS = ['demo/ulysses-19/collate.mjs', 'demo/holmes-untold/extract-instances.mjs'];
t('T6.1', '两个调用方都 import 本部件，不再各写各的规范化', () => {
  const bad = [];
  for (const f of CALLERS) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    if (!/from '.*benxiang\/observe-text\.mjs'/.test(src)) bad.push(`${f} 未引用本象文本观察`);
    if (/function normalize\s*\(/.test(src)) bad.push(`${f} 仍自带 normalize()——职责又摊派回调用方了`);
    if (/replace\(\/\\s\+\/g/.test(src)) bad.push(`${f} 仍自己折叠空白`);
  }
  return bad.length === 0 || bad.join('；');
});

// ───────────────────────── 报告 ─────────────────────────
const rev = results.filter(r => /【反向】/.test(r.desc)).length;
const pass = results.filter(r => r.ok).length;
console.log(`\n═══ 本象 v0.1 文本观察验证（${SPEC}）═══\n`);
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.id.padEnd(6)} ${r.desc}`);
  if (!r.ok) console.log(`        └─ ${r.detail}`);
}
console.log(`\n判决：${pass}/${results.length} ${pass === results.length ? '✅ VERIFIED' : '❌ NOT VERIFIED'}（其中 ${rev} 条是反向用例：把逐行匹配改回来必须变红）`);
process.exit(pass === results.length ? 0 : 1);
