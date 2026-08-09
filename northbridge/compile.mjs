// compile.mjs — 本源北桥 v0.2 上下文编译器（northbridge/0.2）
//
// 根因三（RFC-0006 §0）：北桥被装在 SessionStart，而**那一刻还没有 goal**。
// 它的职责是「CPU 此刻需要知道世界的哪一部分」，却被放在「还不知道要干什么」的时刻——
// 在那个位置上相关性筛选原理性做不对，轮转公平分配已经是天花板（实测仍丢 28/96 条）。
//
// v0.2 把北桥拆成两个时刻：
//   boot   —— SessionStart。没有 goal，只做「开机自检」：有哪些学历、体检如何、当前任务到哪了。
//   request—— UserPromptSubmit。**这一刻 goal 出现了**，才做相关性筛选，按需把相关事实调进来。
//
// 于是「装不下」不再等于「永远看不到」：boot 时装不下的事实，在它变得相关的那一轮会被调入。
// 这正是架构文档 context.request / context.bundle 的内核——之前以「只有一个消费者」拒绝它，
// 那个理由是错的：不是消费者少，是消费者被放在了错误的时刻。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { findStates, recheckSource, health } from '../southbridge/benjing-core.mjs';

export const SPEC = 'northbridge/0.2';

/** 事实的稳定 id：同一条事实在任何会话里算出同一个 id，供「已注入」账本去重 */
export function factId(claim) {
  return 'f:' + crypto.createHash('sha256').update(String(claim)).digest('hex').slice(0, 12);
}

/** 中文没有空格分词，用字符 bigram 做重合度；英文/路径按词。第一版够用，别过早上向量。 */
function grams(s) {
  const t = String(s || '').toLowerCase();
  const out = new Set();
  for (const w of t.match(/[a-z0-9_./-]{2,}/g) || []) out.add(w);
  const cjk = t.replace(/[^一-龥]+/g, '');
  for (let i = 0; i + 1 < cjk.length; i++) out.add(cjk.slice(i, i + 2));
  return out;
}

export function relevance(goal, text) {
  const g = grams(goal), t = grams(text);
  if (!g.size || !t.size) return 0;
  let hit = 0;
  for (const x of g) if (t.has(x)) hit++;
  return hit / Math.sqrt(g.size);   // 除以 sqrt 而非 size：长 goal 不该被稀释掉
}

function loadAll(root) {
  const out = [];
  for (const p of findStates(root)) {
    try {
      const s = JSON.parse(fs.readFileSync(p, 'utf8'));
      out.push({ path: p, rel: path.relative(root, p).replace(/\\/g, '/'), s, mtime: fs.statSync(p).mtimeMs });
    } catch { /* 解析不了的由体检报孤儿，不在这里静默 */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function healthLine(root) {
  try {
    const h = health(root);
    if (!h.issues) return `✔ 体检 ${h.states} 份学历全部健康，无孤儿`;
    const detail = [];
    for (const o of (h.orphans || [])) detail.push(`${o.path} 孤儿(${o.reason})`);
    for (const i of h.items) {
      const bits = [];
      if (i.in_sync === false) bits.push('指纹不符(有人绕过 benjing-put 改过)');
      if (i.locked === false) bits.push('只读位掉了');
      if (i.unverifiable_sources?.length) bits.push(`source不可复核×${i.unverifiable_sources.length}`);
      if (i.dangling_sources?.length) bits.push(`source悬空×${i.dangling_sources.length}(引用物已不在，且无命令可重跑)`);
      if (i.missing_artifacts?.length) bits.push(`artifact缺失×${i.missing_artifacts.length}`);
      if (i.schema_issues?.length) bits.push(`schema违规×${i.schema_issues.length}(${i.schema_issues[0]})`);
      if (bits.length) detail.push(`${i.path} ${bits.join(' ')}`);
    }
    const cap = detail.length <= 3 ? detail.join('；') : detail.slice(0, 3).join('；') + `；…等共 ${detail.length} 项`;
    return `⚠ 体检 ${h.issues} 处问题 / ${h.states} 份学历：${cap}`;
  } catch { return ''; }
}

/**
 * boot：SessionStart。**不做相关性**——这一刻没有 goal，做相关性就是瞎猜。
 * 只给：当前任务的完整状态 + 其余任务的存在性与规模 + 体检 + 怎么按需调更多。
 */
export function compileBoot(root, budget = 6000) {
  const all = loadAll(root);
  if (!all.length) return { text: '', loaded: 0, total: 0 };
  const active = all[0];
  const totalFacts = all.reduce((n, x) => n + (x.s.facts || []).filter(f => f.verified).length, 0);

  const activeFacts = (active.s.facts || []).filter(f => f.verified);
  const bodyOf = (facts) => [
    `── 当前任务 · ${active.rel} ──`,
    `任务：${active.s.title || '(未命名)'}`,
    `目标：${active.s.goal || ''}`,
    `当前状态：${active.s.current_state || ''}`,
    facts.length === activeFacts.length
      ? `已验证事实（本任务全量 ${activeFacts.length} 条）：`
      : `已验证事实（本任务共 ${activeFacts.length} 条，此处展开最近 ${facts.length} 条）：`,
    facts.map(f => {
      const rc = recheckSource(f.source);
      return `- ${f.claim}${f.source ? `（${f.source}）` : ''}${rc.ok ? '' : ' ⚠source不可复核'}`;
    }).join('\n') || '（暂无）',
    (active.s.decisions || []).length
      ? '关键决策：\n' + active.s.decisions.slice(-4).map(d => `- ${d.what} ← ${d.why}`).join('\n') : '',
    '下一步：',
    (active.s.next_steps || []).map((x, i) => `${i + 1}. ${x}`).join('\n') || '（暂无）'
  ].filter(Boolean).join('\n');

  const others = all.slice(1).map(x => {
    const n = (x.s.facts || []).filter(f => f.verified).length;
    const todo = (x.s.next_steps || []).length;
    return `- ${x.rel}｜${x.s.title || x.s.id}｜已验证事实 ${n} 条｜未完成 ${todo} 项`;
  });

  // 头部必须跟着降级一起变。原先它无条件写「当前任务全量装载」——一旦降级触发，
  // 正文只展开了一部分，而头部还在宣称全量：那就是本仓库反复在修的那一类「统计者谎报」。
  // 头部长度会随文案微变，但降级循环每轮重算全文，收敛不受影响。
  const hLine = healthLine(root);
  const headOf = (dropped) => [
    `[本境 boot · ${SPEC}]`,
    `磁盘上 ${all.length} 份学历、${totalFacts} 条已验证事实。`
    + (dropped
      ? `当前任务展开 ${activeFacts.length - dropped}/${activeFacts.length} 条（预算降级，未展开的见文末说明），其余只列目录。`
      : `当前任务全量装载，其余只列目录。`),
    hLine
  ].filter(Boolean).join('\n');
  const head = headOf(0);

  // 目录也有上界：学历数会涨，一行约 60 字符，30 份就是 1800。条数照实报，明细列前 N 条。
  const DIR_MAX = 20;
  const dirLines = others.length <= DIR_MAX
    ? others
    : [...others.slice(0, DIR_MAX), `- …等共 ${others.length} 份，完整清单见 demo/ 目录`];

  const footOf = (extra = '') => [
    '',
    '── 其余学历（未装载正文，按需由北桥在你说出目标后自动调入）──',
    dirLines.join('\n'),
    extra,
    '',
    '—— 请基于以上状态续上任务，不要重新问用户「任务是什么」。',
    '—— 改学历走 node southbridge/benjing-put.mjs（带 --expect）；直接 Write 会被 PreToolUse 拦断。'
  ].filter(x => x !== '' || true).join('\n');

  // ── 超预算时降级谁 ────────────────────────────────────────────
  //
  // 原先是整份 slice 尾巴。但排在尾部的恰恰是**最不能丢的两样**：
  //   ① 其余学历目录——v0.3 的立身之本就是「装不下不等于看不到，目录里列着」，
  //      目录被切等于这个机制当场失效，而头部还在说「其余只列目录」；
  //   ② 「改学历走 benjing-put」——切掉它，模型会直接 Write，然后撞上 PreToolUse 闸门。
  //
  // 实测（2026-08-08，8 份学历）：task4(31 条事实) 与 task3(27 条) 一旦成为活跃任务，
  // boot 分别到 7237 / 7070 字符，双双越过 6000——不是理论风险，是差一次 mtime 更新就发生。
  //
  // 所以改成：**目录与指令是不可降级的固定开销，先扣；要降就降活跃任务的事实列表。**
  // 事实可以降是因为它有去处——source 就在那份 task.origin.json 里，一句话就能查回来；
  // 操作指令没有去处，丢了就是丢了。丢多少条照实写在正文里，不静默。
  const fixedCost = head.length + footOf().length + 4;
  const bodyRoom = budget - fixedCost;

  let usedFacts = activeFacts;
  let factsDropped = 0;
  let text = [head, '', bodyOf(usedFacts), footOf()].join('\n');
  // 收敛：每轮砍掉最早的若干条事实再量一次。事实条数有限，必定终止。
  while (text.length > budget && usedFacts.length > 1) {
    const cut = Math.max(1, Math.ceil((text.length - budget) / Math.max(1, bodyOf(usedFacts).length / usedFacts.length)));
    usedFacts = usedFacts.slice(cut);       // 从最早的开始丢，保留最近确认的
    factsDropped += cut;
    text = [headOf(factsDropped), '', bodyOf(usedFacts), footOf(
      `\n⚠ 活跃任务有 ${factsDropped}/${activeFacts.length} 条较早的已验证事实因预算未展开，` +
      `原文在 ${active.rel}，需要时直接读该文件或向北桥索取。`
    )].join('\n');
  }

  // 兜底：事实降到底仍然超预算（预算被调得极小，或活跃任务的 current_state 本身就很长）。
  //
  // 这里**不能再用 slice 砍尾巴**——砍尾巴就是砍掉目录和那两条操作指令，
  // 而「指令不可降级」这条不变量若只在预算宽裕时成立，那它就不叫不变量。
  // 实测：预算 2000 时旧兜底一触发，三样东西一起没，压力测试当场变三个 ❌。
  //
  // 改为退化到一个**最小可用帧**：说清楚发生了什么 + 上哪儿看 + 两条指令。
  // 它只有几百字符，任何现实预算都装得下；装不下的话那个预算本来也没法工作。
  if (text.length > budget) {
    text = [
      `[本境 boot · ${SPEC}]`,
      `⚠ 预算 ${budget} 装不下正常 boot 摘要（需 ${text.length}）——已退化为最小帧。`,
      `磁盘上 ${all.length} 份学历、${totalFacts} 条已验证事实。当前任务：${active.rel}｜${active.s.title || active.s.id || ''}`,
      `完整状态请直接读该文件，或调高预算重开。`,
      '',
      '—— 请基于以上状态续上任务，不要重新问用户「任务是什么」。',
      '—— 改学历走 node southbridge/benjing-put.mjs（带 --expect）；直接 Write 会被 PreToolUse 拦断。'
    ].join('\n');
  }
  return {
    text, loaded: usedFacts.length, total: totalFacts, states: all.length,
    factsDropped, bodyRoom,
  };
}

/**
 * request：UserPromptSubmit。**这一刻 goal 出现了。**
 * 只调入「与 goal 相关」且「本会话尚未注入过」的事实。没有相关的就什么都不注入——
 * 每轮硬塞是另一种浪费，且会把真正的信号淹掉。
 */
export function compileRequest(root, goal, {
  budget = 2200, already = new Set(), minScore = 0.35, max = 8,
  learningBudget = 900, maxLearnings = 4,
} = {}) {
  const all = loadAll(root);
  if (!all.length) return { text: '', picked: [], considered: 0 };

  const activeRel = all[0].rel;
  const cand = [];
  for (const x of all) {
    for (const f of (x.s.facts || []).filter(f => f.verified)) {
      const id = factId(f.claim);
      if (already.has(id)) continue;
      // active 任务的事实已在 boot 全量给过，这里不重复
      if (x.rel === activeRel) continue;
      const score = relevance(goal, f.claim + ' ' + (f.source || ''));
      if (score >= minScore) cand.push({ id, score, from: x.rel, f });
    }
  }
  cand.sort((a, b) => b.score - a.score);

  const picked = [];
  let used = 0;
  for (const c of cand) {
    if (picked.length >= max) break;
    const line = `- [${c.from}] ${c.f.claim}${c.f.source ? `（${c.f.source}）` : ''}`;
    if (used + line.length > budget) break;
    used += line.length; picked.push({ ...c, line });
  }

  // ── 经验（学堂 xuetang/0.1）──
  // 事实回答「这个任务发生过什么」，经验回答「下次别再这样」。后者才是「上学」的产物，
  // 所以它有独立预算，不跟事实抢——被事实挤掉的经验等于没沉淀。
  //
  // 只调 status==='verified' 的：那意味着它挂着的 recheck 在最近一次考试里真的跑通了。
  // candidate 一律不进——让未验证的经验进上下文，等于把假设当经验用，比不写更糟。
  // 经验天然跨任务（它是从具体任务里抽出来的一般结论），所以**不排除当前任务**。
  const lcand = [];
  for (const x of all) {
    for (const l of (x.s.learnings || [])) {
      if (l.status !== 'verified') continue;
      const id = l.id || factId(l.lesson);
      if (already.has(id)) continue;
      const score = relevance(goal, l.lesson);
      if (score >= minScore) lcand.push({ id, score, from: x.rel, l });
    }
  }
  lcand.sort((a, b) => b.score - a.score);
  const lpicked = [];
  let lused = 0;
  for (const c of lcand) {
    if (lpicked.length >= maxLearnings) break;
    const line = `- ${c.l.lesson}（经验·已通过考试：${c.l.recheck?.run || ''}）`;
    if (lused + line.length > learningBudget) break;
    lused += line.length; lpicked.push({ ...c, line });
  }

  if (!picked.length && !lpicked.length)
    return { text: '', picked: [], learnings: [], considered: cand.length, learningsConsidered: lcand.length };

  const parts = [`[北桥 context.request · ${SPEC}]`];
  if (picked.length) {
    parts.push(`按本轮目标调入 ${picked.length} 条此前未装载的已验证事实（候选 ${cand.length} 条，阈值 ${minScore}）：`);
    parts.push(...picked.map(p => p.line));
    parts.push(`—— 这些来自其他任务的学历，boot 时因预算未装载；因与本轮目标相关而调入。`);
  }
  if (lpicked.length) {
    parts.push(`按本轮目标调入 ${lpicked.length} 条**已通过长循环考试**的经验（候选 ${lcand.length} 条）：`);
    parts.push(...lpicked.map(p => p.line));
    parts.push(`—— 经验只在 recheck 最近一次跑通时才是 verified；跑挂会当场降级（node xuetang/exam.mjs）。`);
  }
  return { text: parts.join('\n'), picked, learnings: lpicked, considered: cand.length, learningsConsidered: lcand.length };
}
