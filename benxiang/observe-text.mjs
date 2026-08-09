// observe-text.mjs — 本象协议 v0.1：文本观察（benxiang/0.1）
//
// 为什么加这个部件：2026-08-09 一个工作会话里，「在整本书里找一个短语」这件事
// 被独立实现了两次，两次都错在同一个地方——
//   1) demo/ulysses-19/collate.mjs：探针 D1 找 "Love, yes. Word known to all men"，
//      因为底本在 "all men" 中间折行而假阴性；
//   2) demo/holmes-untold/extract-instances.mjs：探针 UC31 找 "old Russian woman"，
//      因为正典在 "the old / Russian woman" 折行而假阴性——**修完第一处之后原样复发**。
// 这跟 sha256 在三个文件里各写一遍是同一个形状（见 observe.mjs 顶部与 RFC-0006 §0）：
// 不是同一个 bug 修不干净，是缺失部件的职责被摊派给了每个调用方自己实现。
//
// 本部件只回答一个问题：**这段文本此刻是什么样。**
//
// 独立性铁律（与 observe() 同）：
//   observeText() 只接受「这段文本」和「怎么看」，**永不接受「你觉得里面有什么」**。
//   找什么是 locate() 的事，且必须发生在拿到观察结果之后。

export const SPEC = 'benxiang/0.1';

/**
 * 观察一段文本，产出可跨行搜索的规范化投影。
 * @param {string} text 原文
 * @param {{dropChars?: string}} opts 怎么看——dropChars 里的字符按零宽处理。
 *        默认丢 '_'：Gutenberg 用下划线表斜体（"the cutter _Alicia_"），
 *        不丢的话每条探针都得自己写 _?，那又是把职责摊派回调用方。
 * @returns {{spec:string, kind:string, norm:string, lineAt:number[], properties:object}}
 */
export function observeText(text, opts = {}) {
  if (arguments.length > 2) {
    // 防止后来者加个 expected/probe 参数把观察器变成自证机。宁可炸，也不许悄悄退化。
    throw new Error('benxiang.observeText 只接受 (text, opts)：观察器不得接收任何预期值');
  }
  if (typeof text !== 'string') {
    throw new TypeError('benxiang.observeText 只观察字符串');
  }
  const drop = new Set([...(opts.dropChars ?? '_')]);

  const out = [];
  const lineAt = [];
  let line = 1, prevSpace = false, dropped = 0;

  for (const ch of text) {
    if (drop.has(ch)) { dropped++; continue; }          // 零宽：不占偏移，也不影响行号
    const ws = ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
    if (ws) {
      if (!prevSpace) { out.push(' '); lineAt.push(line); prevSpace = true; }
    } else {
      out.push(ch); lineAt.push(line); prevSpace = false;
    }
    if (ch === '\n') line++;                            // 换行计数在推入之后，空白归属折行前那一行
  }

  return {
    spec: SPEC,
    kind: 'state.text',
    norm: out.join(''),
    lineAt,
    properties: {
      source_chars: [...text].length,
      norm_chars: out.length,
      lines: line,
      dropped_chars: dropped
    }
  };
}

/**
 * 在观察结果里定位模式。刻意与 observeText 分开——「看」和「找」必须是两步。
 * @param {object} observation observeText 的产物
 * @param {RegExp} pattern
 * @param {{context?: number}} opts 引语左右各取多少字符
 * @returns {Array<{index:number, line:number, match:string, quote:string}>}
 */
export function locate(observation, pattern, opts = {}) {
  if (!observation || observation.kind !== 'state.text') {
    throw new TypeError('benxiang.locate 的第一个参数必须是 observeText 的产物');
  }
  if (!(pattern instanceof RegExp)) {
    throw new TypeError('benxiang.locate 的第二个参数必须是 RegExp');
  }
  const ctx = opts.context ?? 90;
  const { norm, lineAt } = observation;
  const rx = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');

  const hits = [];
  for (const m of norm.matchAll(rx)) {
    hits.push({
      index: m.index,
      line: lineAt[m.index],
      match: m[0],
      quote: norm.slice(Math.max(0, m.index - ctx), m.index + m[0].length + ctx).trim()
    });
  }
  return hits;
}
