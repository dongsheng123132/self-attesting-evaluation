#!/usr/bin/env node
// branch-safety.mjs — 堵住 git 化引入的那个洞
//
// 2026-08-09 把这台机器纳入版本控制，收益是证据链终于进了版本控制（论文 §7）。
// 但它引入了一个此前不存在的风险，而且**现有的两道防线都拦不住**：
//
//   学历是活文件。`git checkout` / `git stash` / `git reset --hard` 会用提交里的
//   版本直接覆盖工作区的 task.origin.json——绕过本境的乐观锁（它只管 putState），
//   也绕过 PreToolUse 守卫（它只管 Write/Edit 工具）。另一个并发会话刚写入的
//   已验证事实会**静默消失**，version 还是它自己那份，零告警。
//
// 这正是 task5 那次事故的形状：不是有人恶意覆盖，是一条没人看守的写路径。
//
// 两个模式：
//   precheck  切分支前跑。demo/ 有未提交改动就退出码 1（拦住你）
//   report    装成 .git/hooks/post-checkout。切完之后如实报告哪些学历被 git 动过
//
// 安装（一次）：
//   node hooks/branch-safety.mjs install
//
// 用法：
//   node hooks/branch-safety.mjs precheck && git checkout <branch>

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const mode = process.argv[2] || 'precheck';

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};

if (mode === 'install') {
  const dst = path.join(ROOT, '.git', 'hooks', 'post-checkout');
  if (!fs.existsSync(path.dirname(dst))) {
    console.error('✗ 找不到 .git/hooks —— 这里不是 git 仓库？');
    process.exit(1);
  }
  // .git/hooks 不受版本控制，所以真正的脚本留在 hooks/（进版本控制），
  // 这里只装一个转发器。否则「钩子装没装」会变成又一个只有本机知道的事实。
  fs.writeFileSync(dst,
    '#!/bin/sh\n# 由 hooks/branch-safety.mjs install 生成，逻辑在版本控制里，这里只转发\n' +
    'exec node "$(git rev-parse --show-toplevel)/hooks/branch-safety.mjs" report "$@"\n',
    { mode: 0o755 });
  console.log(`✔ 已装 ${path.relative(ROOT, dst)}（转发到版本控制里的 hooks/branch-safety.mjs）`);
  process.exit(0);
}

if (mode === 'precheck') {
  const { code, out } = git('status', '--porcelain', '--', 'demo');
  if (code !== 0) { console.error('✗ git status 跑不起来，不敢放行'); process.exit(1); }
  if (!out) { console.log('✔ demo/ 干净，切分支不会覆盖任何未提交的学历'); process.exit(0); }
  const lines = out.split('\n').filter(Boolean);
  console.error(`✗ demo/ 有 ${lines.length} 处未提交改动，切分支会用提交里的版本盖掉它们：`);
  for (const l of lines.slice(0, 10)) console.error('    ' + l);
  console.error('');
  console.error('  学历是活文件，可能是另一个并发会话刚写进去的已验证事实。');
  console.error('  git 的写既绕过本境乐观锁，也绕过 PreToolUse 守卫——没人会告诉你它没了。');
  console.error('  先提交（git add demo && git commit），或确认这些改动可以丢弃。');
  process.exit(1);
}

if (mode === 'report') {
  // post-checkout 参数：<旧 HEAD> <新 HEAD> <1=切分支 0=切文件>
  const [prev, next, isBranch] = process.argv.slice(3);
  if (isBranch !== '1' || !prev || !next || prev === next) process.exit(0);
  const { code, out } = git('diff', '--name-only', prev, next, '--', 'demo');
  if (code !== 0) process.exit(0);
  const changed = out.split('\n').filter(f => f.endsWith('task.origin.json'));
  if (!changed.length) process.exit(0);
  console.error('');
  console.error(`⚠ 这次切换动了 ${changed.length} 份学历（git 的写不经乐观锁，也不经守卫）：`);
  for (const f of changed.slice(0, 10)) console.error('    ' + f);
  console.error('  如果刚才有并发会话在写这些学历，它们的改动现在可能已经不在工作区了。');
  console.error('  核对：node southbridge/verify-state.mjs <文件>　与　node .claude/hooks/load-state.mjs');
  process.exit(0);   // 只报告不阻断：checkout 已经发生了，拦已无意义，隐瞒才有害
}

console.error(`用法: node hooks/branch-safety.mjs [precheck|report|install]`);
process.exit(1);
