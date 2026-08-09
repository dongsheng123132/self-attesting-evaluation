// uking-heartbeat.mjs — 学堂闭环的「观察」环节：uking 心跳健康观测器
// 读 uking 的 .session.json，判断：
//   1. 记录的 pid 是否还活着（tasklist 对比）
//   2. 心跳是否新鲜（beat_at 距今 <5 分钟）
//   3. 若 crash.log 有 unclean_exit 但心跳新鲜 → 判定为误报
// 输出健康判决 + 可选：把观测沉淀为 task.origin（供下次会话继承）
// 只读 + 判断，不碰 uking 源码。
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SESSION = 'C:/Users/ZhuanZ/.uking/logs/.session.json';
const CRASH_LOG = 'C:/Users/ZhuanZ/.uking/logs/crash.log';
const STATE_OUT = path.resolve(import.meta.dirname, '..', 'demo/task-heartbeat/task.origin.json');

function main() {
  // 1. 读会话状态
  if (!fs.existsSync(SESSION)) { console.log('❌ 无 .session.json，uking 可能未运行'); process.exit(1); }
  let s;
  try { s = JSON.parse(fs.readFileSync(SESSION, 'utf8')); }
  catch (e) { console.log('❌ .session.json 解析失败:', e.message); process.exit(1); }

  const now = Math.floor(Date.now() / 1000);
  const beatAgo = now - (s.beat_at || 0);
  const pid = s.pid;

  // 2. 检查 pid 是否存活（Windows tasklist）
  let alive = false;
  try {
    const out = execSync('tasklist', { encoding: 'utf8' });
    alive = out.includes(String(pid));
  } catch { /* tasklist 不可用则保守判活着 */ alive = true; }

  // 3. 判断心跳新鲜度
  const beatFresh = beatAgo < 300; // 5 分钟

  // 4. 查 crash.log 最近是否有该 pid 的 unclean_exit
  let unclean = false;
  if (fs.existsSync(CRASH_LOG)) {
    const log = fs.readFileSync(CRASH_LOG, 'utf8');
    unclean = log.includes(`pid=${pid}`) && log.includes('unclean_exit');
  }

  // 5. 判决
  console.log(`═══ uking 心跳观测 ═══`);
  console.log(`pid: ${pid}  | 存活: ${alive ? '✅' : '❌'}`);
  console.log(`心跳距今: ${beatAgo}s (${(beatAgo/60).toFixed(1)} 分钟) | 新鲜: ${beatFresh ? '✅' : '❌'}`);
  console.log(`crash.log 有该 pid 的 unclean_exit 记录: ${unclean ? '⚠️ 是' : '否'}`);

  let verdict;
  if (alive && beatFresh) {
    verdict = unclean
      ? `⚠️ 疑似误报：进程存活+心跳新鲜，但 crash.log 记为 unclean_exit。这是退出检测 bug，进程本身健康。`
      : `✅ 健康：进程存活，心跳新鲜。`;
  } else if (!alive) {
    verdict = `🔴 进程已死：pid ${pid} 不存在。`;
  } else {
    verdict = `🔴 心跳过期（${beatAgo}s）：进程可能挂死。`;
  }
  console.log(`判决: ${verdict}`);

  // 6. 沉淀为 task.origin（学堂闭环）
  const state = {
    spec: '2origin/0.1', kind: 'task.origin', id: 'task-heartbeat',
    title: 'uking 心跳健康观测',
    goal: '持续观测 uking 心跳健康，区分真崩溃与退出检测误报，沉淀 learnings。',
    version: 1,
    scope: 'machine:local',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    current_state: verdict,
    facts: [
      { claim: `pid ${pid} 心跳距今 ${beatAgo}s，进程${alive ? '存活' : '不存活'}`, verified: true, source: '.session.json + tasklist' },
      { claim: unclean ? `crash.log 有 ${pid} 的 unclean_exit 记录` : `crash.log 无 ${pid} 的 unclean_exit 记录`, verified: true, source: 'crash.log' }
    ],
    decisions: [
      { what: 'uking unclean_exit 需区分真崩溃与误报', why: '存活+心跳新鲜时 unclean_exit 是退出检测残留，非崩溃', when: new Date().toISOString() }
    ],
    actions: [
      { verb: 'observe', target: '.session.json + crash.log + tasklist', status: 'done', result: verdict }
    ],
    artifacts: [SESSION, CRASH_LOG],
    verification: verdict,
    next_steps: [
      '若判定误报：uking 应在启动时清理残留心跳（真正修复点）',
      '持续观测：心跳过期阈值建议 5 分钟',
      '把多次误报反馈给 uking 开发者修退出检测'
    ],
    learnings: [
      { lesson: 'uking unclean_exit 常是残留心跳误报，进程本身健康；判据=存活+心跳新鲜', confidence: 0.8, status: 'candidate' }
    ]
  };
  try {
    fs.mkdirSync(path.dirname(STATE_OUT), { recursive: true });
    fs.writeFileSync(STATE_OUT, JSON.stringify(state, null, 2), 'utf8');
    console.log(`\n已沉淀观测到 ${STATE_OUT}`);
  } catch (e) { console.log('（沉淀失败:', e.message, '）'); }

  process.exit(verdict.startsWith('✅') ? 0 : 2);
}

main();
