#!/usr/bin/env node
// publish.mjs — 发布到公开仓库（governance/publish/0.1）
//
// 为什么要有这个：首次公开前的实测发现，基线提交里带进来一份 84K 的 ChatGPT 对话导出
// （含私人会话链接），而 .gitignore 第一行就写着「聊天记录不进版本控制」。
// 规则写下了，没覆盖到那个站点——论文 class H，第三次复发。
//
// 手工剥离要走六步（clone → filter-branch → 清 refs → gc → 改分支名 → push），
// 六步里漏一步就会把私人内容推上去，而且**推上去之后没有任何东西会告诉你**。
// 所以固化成一条命令，并且把闸门放在 push 之前：扫不干净就不推。
//
// 本地仓库的历史一个字节都不动（并发会话常年在写，重写历史会打断它们）。
// 每次发布都是从本地 clone 出一份、剥干净、强推——公开仓库的历史因此是"本地历史减去私有物"。
//
// 用法：
//   node governance/publish.mjs --dry-run   只剥离和体检，不推送（默认）
//   node governance/publish.mjs --push      体检通过后强推到 origin
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REMOTE = 'https://github.com/dongsheng123132/self-attesting-evaluation.git';
const BRANCH = 'main';

// 从历史里整个剥掉的东西。每条都要写清楚为什么，否则下一个人不知道能不能删。
const STRIP_GLOBS = [
  { glob: 'ChatGPT-*.md', why: '会话导出：私人工作内容，且 .gitignore 第一条铁律已禁止' }
];

// push 前的硬闸门。扫到任何一条就拒绝——「推上去再删」对公开仓库不成立。
// 这份清单必须与 PUBLICATION-POLICY.md 第二节逐条对应，由判据 A8.1 双向校验：
// 政策里写了闸门没实现 = 空头承诺；闸门拦了政策没写 = 没人知道为什么被拦。
export const BLOCKERS = [
  { id: 'session-transcript', test: f => /chatgpt|conversation-export/i.test(f), why: '会话导出' },
  { id: 'client-workspace', test: f => /book-project/i.test(f), why: '客户真实工作区' },
  { id: 'private-dir', test: f => f.startsWith('private/'), why: '私有目录' },
  { id: 'hidden-judgeset', test: f => /\/hidden\//.test(f), why: '隐藏判据集（泄露即失效）' }
];

const sh = (args, cwd, quiet = true) =>
  execFileSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'ignore'] : 'inherit' });

// 被 import 时不许跑：判据要读 BLOCKERS 做政策对齐，一 import 就 clone+push 是灾难。
const invokedDirectly = (() => {
  const a1 = process.argv[1];
  if (!a1) return false;
  try { return import.meta.url === new URL(`file://${path.resolve(a1).replace(/\\/g, '/')}`).href; }
  catch { return false; }
})();
if (!invokedDirectly) { /* 只导出 BLOCKERS，什么都不做 */ }
else {

const push = process.argv.includes('--push');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-'));

try {
  console.log(`克隆本地仓库到 ${tmp}（本地历史不受影响）…`);
  sh(['git', 'clone', '--no-local', '-q', ROOT, tmp]);

  for (const { glob, why } of STRIP_GLOBS) {
    console.log(`从全部历史中剥离 ${glob} —— ${why}`);
    execFileSync('git', ['filter-branch', '-f', '--index-filter',
      `git rm --cached --ignore-unmatch '${glob}'`, '--prune-empty', '--', '--all'],
      { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: '1' } });
  }

  // filter-branch 会把原提交留在 refs/original 里，remote-tracking ref 也吊着旧对象。
  // 不清掉的话「剥离」只是看起来剥了——旧 blob 仍会被 push 带走。
  console.log('清除 refs/original 与 remote-tracking ref，并 gc 掉悬挂对象…');
  try { sh(['git', 'remote', 'remove', 'origin'], tmp); } catch { /* 可能已无 */ }
  const stale = sh(['git', 'for-each-ref', '--format=%(refname)', 'refs/original', 'refs/remotes'], tmp)
    .split('\n').filter(Boolean);
  for (const r of stale) sh(['git', 'update-ref', '-d', r], tmp);
  sh(['git', 'reflog', 'expire', '--expire=now', '--all'], tmp);
  sh(['git', 'gc', '--prune=now', '-q'], tmp);

  const cur = sh(['git', 'branch', '--show-current'], tmp).trim();
  if (cur !== BRANCH) sh(['git', 'branch', '-m', BRANCH], tmp);

  // ── 闸门：对**对象库**扫描，不是对工作树 ──────────────────────────────────
  // 只看工作树会漏掉「历史里还有、当前已删」的文件，那正是这个脚本存在的理由。
  console.log('\n体检：扫描全部可达对象（不是只扫工作树）…');
  const objects = sh(['git', 'rev-list', '--all', '--objects'], tmp)
    .split('\n').map(l => l.slice(41)).filter(Boolean);
  const hits = [];
  for (const f of objects) {
    for (const b of BLOCKERS) if (b.test(f)) hits.push({ file: f, why: b.why, id: b.id });
  }
  const tracked = sh(['git', 'ls-files'], tmp).split('\n').filter(Boolean);
  console.log(`  可达对象路径 ${objects.length} 条　工作树文件 ${tracked.length} 个　提交 ${sh(['git', 'rev-list', '--count', 'HEAD'], tmp).trim()} 个`);

  if (hits.length) {
    console.error(`\n❌ 拒绝发布：命中 ${hits.length} 条阻断规则`);
    for (const h of hits.slice(0, 20)) console.error(`   [${h.id}] ${h.file} —— ${h.why}`);
    process.exit(3);
  }
  console.log('  ✅ 阻断规则 0 命中');

  if (!push) {
    console.log(`\n干跑结束。剥离后的仓库留在 ${tmp}，可以先自己翻一遍。`);
    console.log('确认无误后跑：node governance/publish.mjs --push');
    process.exit(0);
  }

  console.log(`\n强推到 ${REMOTE}（公开历史 = 本地历史 − 私有物，所以必然是 force）…`);
  sh(['git', 'remote', 'add', 'origin', REMOTE], tmp);
  sh(['git', 'push', '-f', 'origin', BRANCH], tmp, false);
  console.log('✅ 已发布');
  process.exit(0);
} finally {
  if (push) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } }
}

}
