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
//   precheck  切分支前跑。活学历/账本有未提交改动，或 ignored 学历在历史中曾被追踪，就拦住
//   report    装成 .git/hooks/post-checkout。分支切完之后报告哪些受保护路径被 git 动过
//
// 边界：Git 没有通用的 pre-reset/pre-stash/pre-file-checkout hook。本脚本保护“按约定先跑
// precheck 的分支切换”，不能声称覆盖 reset --hard / stash / checkout <commit> -- <file>。
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
// Git 能绕过协议写入路径的不只 demo/task.origin.json。下面这些 append-only 账本同样是活证据，
// checkout/reset 覆盖它们也会静默丢观察结果。列表必须显式，不能用整个仓库制造永久噪音。
const LIVE_PATHS = [
  'demo',
  'southbridge/audit.log', 'southbridge/idempotency.jsonl', 'southbridge/todo-closures.jsonl',
  'benxiang/observations.jsonl',
  'oob/crosscheck.jsonl', 'oob/env.jsonl'
];
const GENERATED_MARKER = '# 由 hooks/branch-safety.mjs install 生成';

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};

function taskStatePaths(dir = path.join(ROOT, 'demo'), out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) taskStatePaths(full, out);
    else if (e.name === 'task.origin.json') out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
  return out;
}

// ignored 活学历现在不出现在 git status 里；若同一路径在任一历史 ref 曾被追踪，切分支可能覆盖它。
function ignoredHistoryRisks() {
  const risks = [];
  for (const rel of taskStatePaths()) {
    if (git('check-ignore', '-q', '--', rel).code !== 0) continue;
    if (git('log', '--all', '--format=%H', '-1', '--', rel).out) risks.push(rel);
  }
  return risks;
}

if (mode === 'install') {
  const dst = path.join(ROOT, '.git', 'hooks', 'post-checkout');
  if (!fs.existsSync(path.dirname(dst))) {
    console.error('✗ 找不到 .git/hooks —— 这里不是 git 仓库？');
    process.exit(1);
  }
  if (fs.existsSync(dst)) {
    const old = fs.readFileSync(dst, 'utf8');
    if (!old.includes(GENERATED_MARKER)) {
      console.error('✗ 已存在非本工具生成的 post-checkout；拒绝静默覆盖，请人工合并两个 hook。');
      process.exit(1);
    }
  }
  // .git/hooks 不受版本控制，所以真正的脚本留在 hooks/（进版本控制），
  // 这里只装一个转发器。否则「钩子装没装」会变成又一个只有本机知道的事实。
  fs.writeFileSync(dst,
    `#!/bin/sh\n${GENERATED_MARKER}，逻辑在版本控制里，这里只转发\n` +
    'exec node "$(git rev-parse --show-toplevel)/hooks/branch-safety.mjs" report "$@"\n',
    { mode: 0o755 });
  console.log(`✔ 已装 ${path.relative(ROOT, dst)}（转发到版本控制里的 hooks/branch-safety.mjs）`);
  process.exit(0);
}

if (mode === 'precheck') {
  const { code, out } = git('status', '--porcelain', '--', ...LIVE_PATHS);
  if (code !== 0) { console.error('✗ git status 跑不起来，不敢放行'); process.exit(1); }
  const ignoredRisks = ignoredHistoryRisks();
  if (!out && !ignoredRisks.length) {
    console.log('✔ 活学历与运行账本均干净，且无 ignored 学历与历史追踪路径冲突');
    process.exit(0);
  }
  const lines = out.split('\n').filter(Boolean);
  if (lines.length) {
    console.error(`✗ 活学历/运行账本有 ${lines.length} 处未提交改动，切分支会用提交里的版本盖掉它们：`);
    for (const l of lines.slice(0, 10)) console.error('    ' + l);
  }
  if (ignoredRisks.length) {
    console.error(`✗ ${ignoredRisks.length} 份 ignored 活学历在 Git 历史中曾被追踪，切到相关提交可能覆盖它们：`);
    for (const p of ignoredRisks.slice(0, 10)) console.error('    ' + p);
  }
  console.error('');
  console.error('  这些可能是另一个并发会话刚写入的已验证事实、观察或审计记录。');
  console.error('  git 的写既绕过本境乐观锁，也绕过 PreToolUse 守卫——没人会告诉你它没了。');
  console.error('  先按证据策略提交相应路径；不要为切分支而丢弃活账本。');
  process.exit(1);
}

if (mode === 'report') {
  // post-checkout 参数：<旧 HEAD> <新 HEAD> <1=切分支 0=切文件>
  const [prev, next, isBranch] = process.argv.slice(3);
  if (isBranch !== '1' || !prev || !next || prev === next) process.exit(0);
  const { code, out } = git('diff', '--name-only', prev, next, '--', ...LIVE_PATHS);
  if (code !== 0) process.exit(0);
  const changed = out.split('\n').filter(Boolean);
  if (!changed.length) process.exit(0);
  console.error('');
  console.error(`⚠ 这次切换动了 ${changed.length} 份活学历/运行账本（git 的写不经乐观锁，也不经守卫）：`);
  for (const f of changed.slice(0, 10)) console.error('    ' + f);
  console.error('  如果刚才有并发会话在写这些文件，它们的改动现在可能已经不在工作区了。');
  console.error('  核对：node southbridge/verify-state.mjs <文件>　与　node .claude/hooks/load-state.mjs');
  process.exit(0);   // 只报告不阻断：checkout 已经发生了，拦已无意义，隐瞒才有害
}

console.error(`用法: node hooks/branch-safety.mjs [precheck|report|install]`);
process.exit(1);
