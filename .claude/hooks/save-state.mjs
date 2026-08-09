// save-state.mjs — Stop hook（每轮 checkpoint，不是会话结束）
// 官方确认：Stop 在「每轮回答结束」都触发，Ctrl+C 不触发。
// 所以这里只做轻量 trace 追加：把本轮最后一条 assistant 文本追加到 .claude/trace.jsonl。
// trace 是「影」，是学堂提炼经验的原料，不是任务状态本身。
// 任务状态(task.origin.json)由模型干活时主动维护；退出必存档交给 SessionEnd 的 finalize-state.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(here, '..', '..');

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch { /* ignore */ }

let payload = {};
try { payload = JSON.parse(input); } catch { /* ignore */ }

const msg = String(payload.last_assistant_message || '').slice(0, 2000).trim();
if (!msg) { process.exit(0); }

const tracePath = path.join(projectDir, '.claude', 'trace.jsonl');
const rec = JSON.stringify({
  t: new Date().toISOString(),
  session_id: payload.session_id || '',
  kind: 'turn',
  text: msg
});
try { fs.appendFileSync(tracePath, rec + '\n'); } catch { /* ignore */ }

process.exit(0); // 存档型 hook：exit 0 + 无输出
