// probe-append-idempotency.mjs — 复现 RFC-0004 §6.3：append 的 diverged 判定偏严
//
// 结论（2026-08-08 实测）：幂等重放的校验对象是**整文件 sha256**，但 append 动作只造成
// 文件末尾的一段变化。只要别人也往同一文件追加，整文件 sha 就变，A 的原样重试被判 diverged
// ——哪怕 A 那段内容原封不动还在文件里。调用方按 CLI 契约把退出码 4 当失败重试，
// 于是同一段内容被写了两次：**幂等机制亲手诱发了它本要防的重复写。**
//
// 跑法：node southbridge/probe-append-idempotency.mjs
// 全程在系统临时目录沙箱内，不碰真实 demo/ 与 southbridge/audit.log。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let n = 0;
function sandbox() {
  const s = path.join(os.tmpdir(), `sc-append-probe-${process.pid}-${++n}`);
  fs.mkdirSync(path.join(s, 'southbridge'), { recursive: true });
  fs.mkdirSync(path.join(s, 'demo'), { recursive: true });
  fs.copyFileSync(path.join(here, 'shadowcore-core.mjs'), path.join(s, 'southbridge', 'shadowcore-core.mjs'));
  return s;
}
const load = (s) => import(pathToFileURL(path.join(s, 'southbridge', 'shadowcore-core.mjs')).href + `?v=${n}`);

let bad = 0;

// ── 场景一：他人追加后，A 原样重试被判 diverged
{
  const s = sandbox();
  const { doWrite } = await load(s);
  const f = path.join(s, 'demo', 'shared.log');
  const req = { relpath: 'demo/shared.log', content: 'A的记录\n', mode: 'append', idempotency_key: 'kA' };

  const r1 = doWrite(req, 'A');
  fs.appendFileSync(f, 'B的记录\n', 'utf8');   // 另一个 harness 往同一日志追加，完全合法
  const r2 = doWrite(req, 'A');                 // A 没收到上次响应，原样重试
  const body = fs.readFileSync(f, 'utf8');

  console.log('场景一 · append 重试的判决');
  console.log(`  A 首次追加            → ${r1.status}`);
  console.log(`  B 追加后 A 原样重试   → ${r2.status}`);
  console.log(`  文件现状              → ${JSON.stringify(body)}`);
  console.log(`  A 那段还在文件里吗    → ${body.includes('A的记录')}`);
  const isBug = r2.status === 'diverged' && body.includes('A的记录');
  console.log(`  ${isBug ? '✗ 缺陷复现：观察对象错了——校验了整个世界，而这次动作只改了其中一段' : '✓ 判决正确'}\n`);
  if (isBug) bad++;
}

// ── 场景二：这个误判的下游代价（调用方按退出码 4 重试）
{
  const s = sandbox();
  const { doWrite } = await load(s);
  const f = path.join(s, 'demo', 'audit-like.log');
  const req = { relpath: 'demo/audit-like.log', content: 'X\n', mode: 'append', idempotency_key: 'kX' };

  doWrite(req, 'A');
  fs.appendFileSync(f, 'Y\n', 'utf8');
  const r = doWrite(req, 'A');
  if (r.status === 'diverged') doWrite({ ...req, idempotency_key: 'kX-retry' }, 'A');  // 退出码 4 的常规处理
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);

  console.log('场景二 · 误判的下游代价');
  console.log(`  diverged 后换 key 重试 → 文件 ${JSON.stringify(lines)}`);
  const dup = lines.filter(l => l === 'X').length === 2;
  console.log(`  ${dup ? '✗ X 被写了两次：这正是 v0.1 缺陷②「重放两次写两行」的原样复活' : '✓ 无重复写'}\n`);
  if (dup) bad++;
}

console.log(bad ? `判决: ✗ §6.3 缺陷成立（${bad}/2 场景复现）` : '判决: ✓ §6.3 已修复');
process.exit(bad ? 1 : 0);
