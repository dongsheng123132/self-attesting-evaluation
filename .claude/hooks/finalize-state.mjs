// finalize-state.mjs — SessionEnd hook · 本境 v0.2「按内容对账，不按会话计数」
//
// v0.1 干的事：找 mtime 最新的一份，version += 1，刷 updated_at。
// v0.1 的实测缺陷②：内容指纹一字未变，连跑 3 次 SessionEnd，version 从 1 涨到 4。
//   于是 task1=6、task2=12 这些数字只代表「开过几次会」，既不能判断状态变没变，
//   也没法拿来做乐观锁 —— 这就是本境版的「自证式 result」。
//
// v0.2：扫全部学历，逐份比对 content_hash。内容没变就一个字节都不写。
//   顺带修掉「给错任务 +1」——不再挑 mtime 最新的那一份来背锅。
// v0.2+：从 SessionEnd 给的 transcript_path 观测真实模型名（举证缺口对策），
//   并跑一遍便宜的体检落盘，让下次开会能立刻看到学历有没有烂掉。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findStates, reconcile, health } from '../../southbridge/benjing-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(here, '..', '..');

// SessionEnd 的 stdin 里带 transcript_path —— 模型名就在那份 jsonl 里，环境变量里没有
let transcriptPath = null;
try {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (payload && typeof payload.transcript_path === 'string') transcriptPath = payload.transcript_path;
} catch { /* 没有 stdin 也能跑，observeModel 会自己去找 */ }

try {
  for (const f of findStates(projectDir)) {
    try { reconcile(f, transcriptPath); } catch { /* 单份失败不拖垮其余 */ }
  }
} catch { /* ignore */ }

// 体检结果落盘，供下次 SessionStart 在 boot 摘要里亮出来
try {
  fs.writeFileSync(path.join(projectDir, '.claude', 'benjing-health.json'),
    JSON.stringify(health(projectDir), null, 2), 'utf8');
} catch { /* ignore */ }

// 本象「回头看」：跑一轮独立观察并落账本。
// RFC-0006 §6.4 自己写过——**一个不被定期运行的「回头看」等于没有回头看**，
// 别让这个病在本象自己身上复发。挂在 SessionEnd 是零 token 成本的自动化：
// 它是纯 node 脚本，不起模型会话，不像 cron 那样每次烧 token。
try {
  execFileSync(process.execPath, [path.join(projectDir, 'benxiang', 'reobserve.mjs'), '--quiet'],
    { stdio: 'ignore', timeout: 20000 });
} catch { /* 观察失败不该阻断退出；下次开会时体检行会暴露问题 */ }

process.exit(0); // 存档型 hook：exit 0 + 无输出
