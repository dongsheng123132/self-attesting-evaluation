// load-state.mjs — SessionStart hook · 本源北桥 v0.2 的 boot 时刻
//
// v0.1：抓 mtime 最新的一份学历注入 —— 19 条已验证事实只进来 9 条，且无人知道。
// v0.2：编译全量 bundle + 预算 + 轮转 —— 装载率上去了，但学历涨到 96 条时仍丢 28 条，
//       而且**在这一刻做相关性筛选是原理性做不对的：SessionStart 时还没有 goal**（RFC-0006 根因三）。
// v0.3：boot 不再猜相关性。只有 SHADOWOS_ACTIVE_TASK 显式绑定后，才做
//       当前任务全量 + 同治理作用域学历目录 + 体检；未绑定时不展示任何学历正文。
//       相关性交给 UserPromptSubmit 时刻的 context.request（.claude/hooks/context-request.mjs）。
//
// 于是「预算装不下」不再等于「这辈子看不到」：目录里列着，相关时会被调入。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileBoot } from '../../northbridge/compile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = process.env.SHADOWOS_PROJECT_ROOT
  ? path.resolve(process.env.SHADOWOS_PROJECT_ROOT)
  : path.resolve(here, '..', '..');
const activeRel = String(process.env.SHADOWOS_ACTIVE_TASK || '').trim();

function emit(ctx) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx }
  }));
  process.exit(0);
}

try { emit(compileBoot(projectDir, { activeRel }).text); }
catch { emit(''); }  // 开会不能被 boot 摘要挡住
