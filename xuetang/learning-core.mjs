// learning-core.mjs — 学堂协议 v0.1：经验的产生、升降级与读取
//
// 为什么现在才写：`learnings` 这个字段从第一天就在 schema 里，也被本境的缩水守卫
// 保护着（B11.3b / B12.1），但**全仓库没有一行代码写过或读过它**，10 份学历累计 0 条。
// 那正是本仓库已经命名过的病：「一份纯装饰的 schema——它让人以为格式被约束着，
// 而现实里没有」。字段在、守卫在、机制不在，等于没有。
//
// 设计只有一条主心骨，来自本仓库已经付过学费的那个对称：
//
//     fact 的 source 必须引用**可复核物**（recheckSource）
//     → 那么 learning 的 recheck 必须是**可重跑的动作**
//
// 由此推出五条规则，每条都对应一次实测教训，不是设计美学：
//
//   R1 没有可重跑检验的经验，最高只能是 candidate。
//      「未验证的话不配叫 fact，叫假设」——经验同理，而且经验比事实更容易自我感动。
//   R2 升级只能由考试给，作者不能给自己发证。
//      写入时 status 只允许 candidate / deprecated；verified 只能由 exam 在 recheck
//      通过后写。这是「决策权与判断依据分离」在学堂层的落地。
//   R3 一次成功不是永久真理：verified 的经验每次考试都要重跑，跑挂了当场降级。
//   R4 考试必须记账：pass / fail / error 逐条落盘，且降级要说明是哪次考试降的。
//   R5 只有 verified 才会被北桥注入上下文；candidate 不进。
//      让未验证的经验进上下文，等于把假设当经验用——比不写更糟。
//
// 这个文件只做纯逻辑（判断、升降级、聚合），**不碰磁盘写**：落盘一律走本境
// benjing-put 的乐观锁。学堂自己开一条写路径，就是 task5 那次学历被吃掉的复刻。

import { createHash } from 'node:crypto';

export const SPEC = 'xuetang/0.1';

/** 经验 id：由 lesson 正文决定，跨学历同一条经验得到同一个 id（用于去重与考试记账） */
export function learningId(lesson) {
  return 'L-' + createHash('sha256').update(String(lesson || '').trim()).digest('hex').slice(0, 12);
}

// 可重跑动作的首词白名单。刻意与本境 recheckSource 的 cmdRe 保持同一套词，
// 因为它们回答的是同一个问题：「这句话能不能被别人独立跑一遍」。
// 不做 shell 解释、不允许管道与重定向——考试跑的是命令，不是脚本。
// 这里没有 bash，两个独立理由：
//   ① 判据 X7.3 要求「学堂能跑的，本境必须也认得」，而本境的 cmdRe 里没有 bash；
//   ② 更要命的是 `bash x.sh` 会把上面「跑命令不跑脚本」的保证从后门整个绕过——
//      我拦住了 run 字符串里的管道，却挡不住脚本文件里的管道。
// 想把 conformance 那种 .sh 当考题，就先给它一个 node 入口，别在这里开口子。
export const ALLOWED_CMDS = ['node', 'npm', 'npx', 'git', 'ls', 'cat', 'wc', 'tail', 'head',
                             'grep', 'find', 'curl', 'codex', 'claude', 'hermes', 'python'];

// 本境 recheckSource 认、而学堂**故意不认**的命令，连同理由。
// 两者回答的问题看着一样，其实差一个动词：本境只是**认出**一句话里提到了命令
// （它从不执行），学堂是**反复自动执行**。让 rm 当考题，等于给一个会被定时跑的
// 东西发了删除权。所以差集不是疏漏，是决定——但必须写下来、被判据锁住，
// 否则下一个人补白名单时不知道这里躺过一个决定。
export const EXECUTION_DENIED = {
  rm: '会删除世界。考题只许观察，不许改变被观察的东西',
  touch: '会创造文件，从而改变下一次考试的前提（考试不能给自己造考场）',
};
const SHELLY = /[|><&;`$\n]/;

/**
 * recheck 是否是一个「可重跑的动作」。
 * 返回 {ok, reason, argv}。ok=false 时 reason 要能直接印给人看。
 */
export function checkRecheck(rc) {
  if (!rc || typeof rc !== 'object') return { ok: false, reason: '没有 recheck：这条经验无法被任何人重跑，只能当 candidate' };
  if (rc.kind !== 'command') return { ok: false, reason: `recheck.kind=${JSON.stringify(rc.kind)} 不支持（v0.1 只认 command）` };
  const run = String(rc.run || '').trim();
  if (!run) return { ok: false, reason: 'recheck.run 为空' };
  if (SHELLY.test(run)) return { ok: false, reason: 'recheck.run 含管道/重定向/换行——考试跑命令不跑脚本，别把一句可复核的话变成一段没人读得懂的 shell' };
  const argv = run.split(/\s+/).filter(Boolean);
  if (!ALLOWED_CMDS.includes(argv[0])) {
    return { ok: false, reason: `recheck.run 的首词 ${JSON.stringify(argv[0])} 不在白名单（${ALLOWED_CMDS.slice(0, 6).join('/')}…）` };
  }
  if (rc.expect_exit != null && !Number.isInteger(rc.expect_exit)) {
    return { ok: false, reason: 'recheck.expect_exit 必须是整数' };
  }
  return { ok: true, reason: '', argv };
}

/**
 * 单条经验的形式校验（不跑命令，只看形状）。
 * 注意它**不判断经验对不对**——那是考试的事。这里只判断「它有没有资格被考」。
 */
export function checkLearning(l) {
  const issues = [];
  if (!l || typeof l !== 'object') return { ok: false, issues: ['不是对象'] };
  const lesson = String(l.lesson || '').trim();
  if (!lesson) issues.push('lesson 为空');
  if (lesson && lesson.length < 8) issues.push('lesson 太短，写不下一条能被推翻的主张');
  if (!['candidate', 'verified', 'deprecated'].includes(l.status)) issues.push(`status=${JSON.stringify(l.status)} 不合法`);
  if (l.confidence != null && !(l.confidence >= 0 && l.confidence <= 1)) issues.push('confidence 不在 [0,1]');

  const rc = checkRecheck(l.recheck);
  // R1：没有可重跑检验就不许叫 verified
  if (l.status === 'verified' && !rc.ok) issues.push(`verified 但无可重跑检验：${rc.reason}`);
  return { ok: issues.length === 0, issues, recheck: rc };
}

/**
 * R2：作者不能给自己发证。
 * 用在写入路径上：把外来的 learnings 规范化——凡是没有考试记录（exam.runs>0 且
 * last_result==='pass'）却自称 verified 的，一律压回 candidate，并记下被压的原因。
 * 返回 {learnings, demoted:[{id,lesson,why}]}
 */
export function normalizeForWrite(learnings) {
  const out = [];
  const demoted = [];
  for (const raw of learnings || []) {
    const l = { ...raw };
    l.id = l.id || learningId(l.lesson);
    const passed = l.exam && l.exam.runs > 0 && l.exam.last_result === 'pass';
    if (l.status === 'verified' && !passed) {
      demoted.push({ id: l.id, lesson: l.lesson, why: '自称 verified 但没有考试通过记录——升级只能由考试给' });
      l.status = 'candidate';
    }
    const c = checkRecheck(l.recheck);
    if (l.status === 'verified' && !c.ok) {
      demoted.push({ id: l.id, lesson: l.lesson, why: `verified 但 recheck 不可跑：${c.reason}` });
      l.status = 'candidate';
    }
    out.push(l);
  }
  return { learnings: out, demoted };
}

/**
 * R3：把一次考试结果套用到经验上，返回新的经验对象（纯函数，不写盘）。
 * result ∈ pass | fail | error
 *   pass  → candidate 升 verified；verified 保持
 *   fail  → verified 当场降 candidate（确定性命令跑挂一次就够了，不必攒次数）
 *   error → 不升不降，但计入 errors。跑不起来 ≠ 经验错了，也 ≠ 经验对了
 */
export function applyExam(l, result, { when, detail = '' } = {}) {
  const n = { ...l, exam: { ...(l.exam || {}) } };
  const e = n.exam;
  e.runs = (e.runs || 0) + 1;
  e.last_run = when;
  e.last_result = result;
  e.last_detail = detail.slice(0, 300);
  if (result === 'pass') {
    e.passes = (e.passes || 0) + 1;
    if (n.status === 'candidate') { n.status = 'verified'; e.promoted_at = when; }
  } else if (result === 'fail') {
    e.fails = (e.fails || 0) + 1;
    if (n.status === 'verified') { n.status = 'candidate'; e.demoted_at = when; e.demoted_by = 'exam'; }
  } else {
    e.errors = (e.errors || 0) + 1;
  }
  return n;
}

/** 跨学历聚合：按 id 去重，同一条经验出现在多份学历里时保留考试记录最全的那份 */
export function collect(states) {
  const byId = new Map();
  for (const { rel, s } of states) {
    for (const l of (s.learnings || [])) {
      const id = l.id || learningId(l.lesson);
      const cur = byId.get(id);
      const runs = (l.exam && l.exam.runs) || 0;
      if (!cur || runs > ((cur.l.exam && cur.l.exam.runs) || 0)) byId.set(id, { id, from: rel, l });
      else cur.also = [...(cur.also || []), rel];
    }
  }
  return [...byId.values()];
}
