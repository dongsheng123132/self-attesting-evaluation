// context-request.mjs — UserPromptSubmit hook · 本源北桥 v0.2 的「有 goal 那一刻」
//
// 这是根因三的修法：北桥原来装在 SessionStart，那一刻还没有 goal，相关性筛选原理上做不对。
// UserPromptSubmit 是 goal 第一次出现的时刻——北桥该在这里工作。
//
// 每轮只调入「与本轮目标相关」且「本会话尚未注入过」的事实；没有相关的就一条都不注入。
// 每轮硬塞是另一种浪费，而且会把真正的信号淹掉。
//
// 失败必须静默放行：这个 hook 挡在用户每一句话前面，它自己绝不能成为阻塞点。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = process.env.SHADOWOS_PROJECT_ROOT
  ? path.resolve(process.env.SHADOWOS_PROJECT_ROOT)
  : path.resolve(here, '..', '..');
const activeRel = String(process.env.SHADOWOS_ACTIVE_TASK || '').trim();

function bail() { process.exit(0); } // 无输出 = 不注入任何东西

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { bail(); }

const goal = String(payload.prompt || '').trim();
if (goal.length < 4) bail();          // 「继续」「好的」这类没有信息量，不触发检索
const sid = String(payload.session_id || 'nosession').replace(/[^\w-]/g, '');

const ledgerPath = path.join(projectDir, '.claude', `nb-injected-${sid}.json`);
let already = new Set();
try { already = new Set(JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))); } catch { /* 首轮 */ }

let mod;
try { mod = await import('../../northbridge/compile.mjs'); } catch { bail(); }

let out;
try { out = mod.compileRequest(projectDir, goal, { already, activeRel }); } catch { bail(); }
if (!out.text) bail();

// 记账：注入过的不再重复注入。这样整个学历库在一次会话里可以被逐步、按需地全部够到，
// 而不是 boot 时一次性塞爆预算。
try {
  for (const p of out.picked) already.add(p.id);
  for (const p of (out.learnings || [])) already.add(p.id);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify([...already]), 'utf8');
} catch { /* 记账失败不影响本轮注入，最多下轮重复一次 */ }

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: out.text }
}));
process.exit(0);
