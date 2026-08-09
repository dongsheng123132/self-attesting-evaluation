#!/usr/bin/env node
// env-probe.mjs — 带外观察面 v0.1（oob/0.1）· 环境健康快照
//
// 为什么有它（RFC-0002 §1 案子 4，代价：一整个任务周期）：
//   demo/task2 把「codex 写不进盘」归因为「沙箱只读策略拦截」，作为 verified fact 存活了一个任务周期。
//   真因是两件事：harness 的工具审批闸门 + **本机 codex 的 Windows 沙箱 runner 本身是坏的**
//   （CreateProcessAsUserW failed: 5，连只读的 Get-Date 都起不来）。
//   没有任何人观察过「这台机器现在还能不能起一个进程」——机器不但报错，还自信地报了个错误的病因。
//
// 设计约束，全部来自 RFC-0002：
//   R2 观察者必须比被观察者笨 —— 本文件只做三件事：跑、记退出码、跟上次比。**不解释、不推断、不修复。**
//   R1 独立 = 不共享失效模式 —— 不 import 本境/北桥/影核的任何逻辑。它们坏了，这里要照样能跑。
//   A4 缺席不会自己发声 —— 探针跑不了要记 unknown + 原因，**绝不允许静默跳过**。
//   静默即缺陷 —— 每个探针必须留下确定判决；没有"没消息就是好消息"。
//
// 用法：
//   node oob/env-probe.mjs            # 人看：一行摘要到 stderr，JSON 到 stdout
//   node oob/env-probe.mjs --quiet    # 只落盘，不打印（hook 用）
// 退出码：0 = 全部 ok / 1 = 有 fail 或 unknown。**环境不健康要能被脚本发现。**
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const LOG = process.env.OOB_LOG || path.join(here, 'env.jsonl');
export const SPEC = 'oob/0.1';

// ── 探针：每个必须返回 {verdict, detail}，verdict ∈ ok|fail|unknown ─────────────
// 顺序是有讲究的：先探底层基质，再探建在它上面的东西。
// 基质坏了（起不了进程），上层的一切失败都是继发的——案子 4 就是把继发当成了根因。

/** P1 · 这台机器现在还能不能起一个最小子进程。这是 case-4 的那一行。
 *  OOB_SPAWN_BIN 是给验证器做故障注入用的（同 southbridge 的 SHADOWCORE_AUDIT_LOG 做法）：
 *  「起不了进程时报 fail」这条分支正是本文件存在的理由，它必须能被反向用例打到，
 *  否则这个探针就是个永远说 ok 的摆设。 */
function probeSpawn() {
  const t0 = Date.now();
  try {
    const bin = process.env.OOB_SPAWN_BIN || process.execPath;
    const r = spawnSync(bin, ['-e', '0'], { timeout: 10000, encoding: 'utf8' });
    const ms = Date.now() - t0;
    if (r.error) return { verdict: 'fail', detail: `起进程失败: ${r.error.message}`, ms };
    if (r.status !== 0) return { verdict: 'fail', detail: `退出码 ${r.status}: ${(r.stderr || '').trim().slice(0, 200)}`, ms };
    return { verdict: 'ok', detail: `node -e 0 退出码 0`, ms };
  } catch (e) {
    return { verdict: 'unknown', detail: `探针自身异常: ${e.message}`, ms: Date.now() - t0 };
  }
}

/** P2 · 写路径端到端还通不通：走南桥 CLI（无头 harness 用的正是这条路），再独立回读比对。 */
function probeWritePath() {
  const t0 = Date.now();
  const relpath = 'demo/_oob/probe.md';
  const abs = path.join(ROOT, relpath);
  const cli = path.join(ROOT, 'southbridge', 'southbridge-cli.mjs');
  try {
    if (!fs.existsSync(cli)) return { verdict: 'unknown', detail: '南桥 CLI 不存在', ms: Date.now() - t0 };

    // 覆盖已存在文件是 medium 风险，得先出示"证明你读过"——顺带把批准通路也探了
    const args = ['write', '--relpath', relpath, '--content', `oob probe\n`];
    if (fs.existsSync(abs)) {
      const cur = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      args.push('--expect-sha256', cur);
    }
    const r = spawnSync(process.execPath, [cli, ...args], { timeout: 20000, encoding: 'utf8' });
    const ms = Date.now() - t0;
    if (r.error) return { verdict: 'fail', detail: `南桥 CLI 起不来: ${r.error.message}`, ms };

    let res = null;
    try { res = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { /* 下面按 null 处理 */ }
    if (!res) return { verdict: 'fail', detail: `南桥无可解析输出，退出码 ${r.status}`, ms };
    if (res.status !== 'done' && res.status !== 'replayed') {
      return { verdict: 'fail', detail: `南桥判决 ${res.status}: ${String(res.reason || '').slice(0, 120)}`, ms };
    }

    // 不采信南桥自报的 sha —— 独立回读。两个观察者不一致才是真信号（RFC-0002 §4）
    if (!fs.existsSync(abs)) return { verdict: 'fail', detail: '南桥报 done 但磁盘上没有该文件', ms };
    const onDisk = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    if (res.evidence?.sha256 && onDisk !== res.evidence.sha256) {
      return { verdict: 'fail', detail: `南桥自报 sha 与磁盘不符：${res.evidence.sha256.slice(0, 12)} vs ${onDisk.slice(0, 12)}`, ms };
    }
    return { verdict: 'ok', detail: `南桥 ${res.status}，磁盘回读一致 ${onDisk.slice(0, 12)}`, ms };
  } catch (e) {
    return { verdict: 'unknown', detail: `探针自身异常: ${e.message}`, ms: Date.now() - t0 };
  }
}

/** P3 · 现在是谁在跑。版本变了往往就是故障变了——codex 0.147.0 那次的关键就是版本。 */
function probeHarness() {
  const t0 = Date.now();
  try {
    const e = process.env;
    const harness = e.CLAUDE_CODE_ENTRYPOINT ? 'claude-code'
      : (e.CODEX_SANDBOX || e.CODEX_HOME) ? 'codex'
      : e.HERMES_HOME ? 'hermes' : 'unobserved';
    const detail = `harness=${harness} node=${process.version} platform=${process.platform} ${process.arch}`;
    // 观察不到就写 unobserved，不编造。model 的识别在别处（本境 actor），这里刻意不依赖它——
    // 带外观察者不能 import 它要观察的系统（R1）。
    return { verdict: harness === 'unobserved' ? 'unknown' : 'ok', detail, ms: Date.now() - t0 };
  } catch (e) {
    return { verdict: 'unknown', detail: `探针自身异常: ${e.message}`, ms: Date.now() - t0 };
  }
}

const PROBES = [
  ['spawn', probeSpawn],
  ['write_path', probeWritePath],
  ['harness', probeHarness]
];

/** 跑一轮。探针抛异常也必须变成 unknown 记录，不能让整轮消失。 */
export function runProbes() {
  const results = {};
  for (const [name, fn] of PROBES) {
    try { results[name] = fn(); }
    catch (e) { results[name] = { verdict: 'unknown', detail: `探针崩溃: ${e.message}`, ms: 0 }; }
  }
  return results;
}

/** 读上一条快照。读不到就是读不到，不猜。 */
export function lastSnapshot(logPath = LOG) {
  try {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i]); } catch { /* 坏行跳过 */ }
    }
  } catch { /* 没有就是没有 */ }
  return null;
}

/** 跟上次比。真相来自分歧（RFC-0002 §4）——这里只报分歧，不解释分歧。 */
export function diffAgainst(prev, now) {
  if (!prev) return { first_run: true, changed: [] };
  const changed = [];
  for (const [name, r] of Object.entries(now)) {
    const p = prev.probes?.[name];
    if (!p) { changed.push(`${name}: 新增探针`); continue; }
    if (p.verdict !== r.verdict) changed.push(`${name}: ${p.verdict} → ${r.verdict}`);
    else if (p.detail !== r.detail) changed.push(`${name}: 判决未变但细节变了（${r.detail}）`);
  }
  for (const name of Object.keys(prev.probes || {})) {
    if (!(name in now)) changed.push(`${name}: 探针消失`);   // 缺席要发声（A4）
  }
  return { first_run: false, changed };
}

export function snapshot(logPath = LOG) {
  const probes = runProbes();
  const prev = lastSnapshot(logPath);
  const diff = diffAgainst(prev, probes);
  const verdicts = Object.values(probes).map(p => p.verdict);
  const snap = {
    spec: SPEC,
    t: new Date().toISOString(),
    verdict: verdicts.includes('fail') ? 'fail' : verdicts.includes('unknown') ? 'unknown' : 'ok',
    probes, ...diff
  };
  // 落盘失败必须让调用方看见，不能吞（静默即缺陷）
  try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); fs.appendFileSync(logPath, JSON.stringify(snap) + '\n', 'utf8'); }
  catch (e) { snap.log = `write-failed: ${e.message}`; }
  return snap;
}

/** 给 boot 用的一行摘要。人和模型都读这一行。 */
export function summaryLine(snap) {
  const bad = Object.entries(snap.probes).filter(([, p]) => p.verdict !== 'ok');
  const head = bad.length
    ? `⚠ 环境 ${bad.map(([n, p]) => `${n}=${p.verdict}`).join(' ')}`
    : `✔ 环境三项探针全通过`;
  const ch = snap.first_run ? '（首次快照，无可比对）'
    : snap.changed.length ? `　⚠ 与上次相比：${snap.changed.join('；')}` : '　与上次一致';
  const why = bad.length ? `　—— ${bad.map(([, p]) => p.detail).join('；')}` : '';
  return head + ch + why;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const snap = snapshot();
  if (!process.argv.includes('--quiet')) {
    process.stdout.write(JSON.stringify(snap) + '\n');
    if (process.stderr.isTTY) process.stderr.write(summaryLine(snap) + '\n');
  }
  process.exit(snap.verdict === 'ok' ? 0 : 1);
}
