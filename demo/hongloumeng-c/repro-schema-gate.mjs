#!/usr/bin/env node
/**
 * repro-schema-gate.mjs — 本境写入闸门缺 schema 校验（实测复现）
 *
 * 实测经过（2026-08-09，C 轨开工时踩到）：
 *   artifacts[] 按 schema 是 string[]，我写成了 [{path,what}]。
 *   benjing-put --create 照收不误，返回 status=done、version=1。
 *   随后 benxiang/observe.mjs 与 southbridge/verify-state.mjs 双双 ERR_INVALID_ARG_TYPE 崩溃，
 *   本象 X6.1 由 14/14 掉到 13/14。schema-check.mjs 本身是好的——它能检出、也确实退出 1，
 *   只是写入路径上没人调用它。
 *
 * 也就是说：**校验器存在 ≠ 校验发生了**。这跟本仓反复记录的
 * 「存在性检查冒充验证」是同一族缺陷，只是换了一层——这次是「校验器存在冒充校验已执行」。
 *
 * 本脚本的语义：
 *   exit 0 = 洞还在（写入闸门仍接受 schema 违规的学历）
 *   exit 1 = 洞被补上了（写入被拒），此时挂在这条经验上的 recheck 应当被降级/改写
 *
 * 用法：node demo/hongloumeng-c/repro-schema-gate.mjs [--json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const asJson = process.argv.includes('--json');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'benjing-schemagate-'));
const target = path.join(sandbox, 'task.origin.json');
const draft = path.join(sandbox, 'draft.json');

// 一份除 artifacts 外完全合规的学历；artifacts 故意用对象形式（schema 要求 string）
fs.writeFileSync(draft, JSON.stringify({
  spec: '2origin/0.2', kind: 'task.origin',
  id: 'schemagate-probe', title: 'schema 闸门探针', goal: '证明写入闸门是否校验 schema',
  version: 1, created_at: '2026-08-09T00:00:00Z',
  current_state: '探针用，不承载真实任务',
  facts: [], decisions: [],
  artifacts: [{ path: 'a.txt', what: '故意写成对象——schema 要求 string' }],
  next_steps: [], learnings: [], actions: [],
}, null, 2));

function run(cmd, args) {
  try {
    const stdout = execFileSync(cmd, args, { encoding: 'utf8', cwd: ROOT, maxBuffer: 1e8 });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? -1, stdout: (e.stdout || '') + (e.stderr || '') };
  }
}

// 1) 独立的 schema 校验器怎么说？（它应该抓得住）
const putRes = run('node', [path.join(ROOT, 'southbridge/benjing-put.mjs'), target, '--create', '--from', draft]);
const wroteToDisk = fs.existsSync(target);
const checkRes = wroteToDisk
  ? run('node', [path.join(ROOT, 'southbridge/schema-check.mjs'), target])
  : { code: null, stdout: '(未落盘，无从校验)' };

// 2) 下游部件拿到这份学历会怎样？（本象观察器）
let downstream = { code: null, note: '(未落盘)' };
if (wroteToDisk) {
  const s = JSON.parse(fs.readFileSync(target, 'utf8'));
  const r = run('node', [path.join(ROOT, 'benxiang/observe.mjs'), JSON.stringify(s.artifacts[0])]);
  downstream = { code: r.code, note: r.stdout.includes('ERR_INVALID_ARG_TYPE') ? '崩溃 ERR_INVALID_ARG_TYPE' : '未崩溃' };
}

const gateHoleOpen = putRes.code === 0 && wroteToDisk && checkRes.code === 1;

const result = {
  verdict: gateHoleOpen ? 'HOLE_OPEN' : 'GATE_ENFORCES_SCHEMA',
  benjing_put_exit: putRes.code,
  written_to_disk: wroteToDisk,
  schema_check_exit: checkRes.code,
  downstream_observe: downstream,
  sandbox,
};

fs.rmSync(sandbox, { recursive: true, force: true });

if (asJson) { console.log(JSON.stringify(result, null, 2)); }
else {
  console.log('═══ 本境写入闸门 · schema 校验复现 ═══\n');
  console.log(`benjing-put --create 退出码   ${result.benjing_put_exit}${result.benjing_put_exit === 0 ? '（接受）' : '（拒绝）'}`);
  console.log(`学历是否落盘                  ${result.written_to_disk ? '是' : '否'}`);
  console.log(`同一份文件 schema-check 退出码 ${result.schema_check_exit}${result.schema_check_exit === 1 ? '（判为不合规）' : ''}`);
  console.log(`下游本象 observe             ${result.downstream_observe.note}`);
  console.log(gateHoleOpen
    ? '\n→ HOLE_OPEN：写入闸门只做乐观锁，不做 schema 校验。\n  校验器存在，但写入路径上没人调用它——不合规的学历能合法入盘，\n  然后在下游以 TypeError 的形式爆出来，看上去像「程序 bug」而不是「数据不合规」。'
    : '\n→ GATE_ENFORCES_SCHEMA：写入闸门已拒绝不合规学历，本复现所依据的缺陷已消失。');
}
process.exit(gateHoleOpen ? 0 : 1);
