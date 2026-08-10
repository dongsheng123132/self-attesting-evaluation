#!/usr/bin/env node
// benjing-put.mjs — 学历写入的唯一合法入口（本境 v0.2 · 乐观锁）
//
// 为什么需要它：实测缺陷④ —— 两个 harness 各自读同一份 task.origin.json、各加一条已验证事实、
// 先后写回，后写的把先写的那条学历静默吃掉，version 双方都以为自己 +1，全程零告警。
// 影核 v0.2 对 demo/ 下的普通文件都上了 expect_sha256 乐观锁，而更贵的学历文件反倒裸奔。
//
// 用法：
//   node southbridge/benjing-put.mjs --show demo/task4/task.origin.json
//       → 打印当前 content_hash（这就是你要拿去 --expect 的凭据）
//   node southbridge/benjing-put.mjs demo/task4/task.origin.json --expect <hash> --from new.json
//   node southbridge/benjing-put.mjs demo/task4/task.origin.json --create --from new.json
//   cat new.json | node southbridge/benjing-put.mjs demo/task4/task.origin.json --expect <hash>
//
// 退出码：0=done/unchanged  3=diverged（盘上被别人改过，别硬写，先合并）  4=denied  1=failed
import fs from 'node:fs';
import { readState, putState, patchState } from './benjing-core.mjs';

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const has = n => argv.includes(n);
const target = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--expect'
  && argv[argv.indexOf(a) - 1] !== '--from' && argv[argv.indexOf(a) - 1] !== '--show')
  || flag('--show');

if (!target) {
  console.error('用法: benjing-put.mjs <state.json> --expect <hash> [--from <file>] | --show <state.json>');
  process.exit(1);
}

if (has('--show')) {
  if (!fs.existsSync(target)) { console.error('不存在:', target); process.exit(1); }
  const { state, computed } = readState(target);
  console.log(JSON.stringify({
    path: target, version: state.version, recorded_hash: state.content_hash || null,
    computed_hash: computed,
    in_sync: state.content_hash === computed,
    note: state.content_hash === computed ? '盘上内容与自记指纹一致'
      : '⚠ 内容与自记指纹不符：有人绕过协议改过这份学历，或尚未 reconcile'
  }, null, 2));
  process.exit(0);
}

// ── 字段级写入（本境 v0.2 · patchState）────────────────────────────────────
// 「共享状态文件绝不能读进内存再整体写回」这条规矩此前只存在于 CLAUDE.md，
// 而唯一的工具正是整体写回。这两个子命令是它的可执行形态。
//   --append <字段> --value <json>   追加：可交换，自动 CAS 重试，并发不丢
//   --set    <字段> --value <文本>   赋值：不可交换，diverged 直接报错交给人
if (has('--append') || has('--set')) {
  const op = has('--append') ? 'append' : 'set';
  const field = flag('--' + op);
  const raw = flag('--value');
  if (!field || raw === null) { console.error(`用法: --${op} <字段> --value <${op === 'append' ? 'json' : '文本'}>`); process.exit(1); }
  let value = raw;
  if (op === 'append') {
    try { value = JSON.parse(raw); }
    catch (e) { console.error('--value 不是合法 JSON:', e.message); process.exit(1); }
  }
  const r = patchState(target, { op, field, value });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.status === 'done' || r.status === 'unchanged' ? 0
    : r.status === 'diverged' ? 3 : r.status === 'denied' ? 4 : 1);
}

let payload;
const from = flag('--from');
try {
  payload = JSON.parse(from ? fs.readFileSync(from, 'utf8') : fs.readFileSync(0, 'utf8'));
} catch (e) {
  console.error('新状态读取/解析失败:', e.message); process.exit(1);
}

const expect = has('--create') ? null : flag('--expect');
if (!has('--create') && !expect) {
  console.error('拒绝：写学历必须带 --expect <hash>（先 --show 拿）。新建用 --create');
  process.exit(4);
}

const r = putState(target, payload, { expect });
console.log(JSON.stringify(r, null, 2));
process.exit(r.status === 'done' || r.status === 'unchanged' ? 0
  : r.status === 'diverged' ? 3 : r.status === 'denied' ? 4 : 1);
