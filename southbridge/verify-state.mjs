// verify-state.mjs — C5 结果可验证：通过观察现实验证，不是信 exit code
// 读 task.origin.json，检查：
//   1. 声称的 artifacts[] 是否真实存在（观察现实文件系统）
//   2. facts[] 里 verified:true 的 source 是否可复核（v0.2 升级：不再只判非空）
//   3. next_steps 与 current_state 是否自洽（完成度）
//   4. content_hash 是否与实际内容相符（v0.2 新增：检测绕过协议的改写）
// 输出真正的 VERIFY 结论，不信任任何「我说我完成了」。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recheckSource, contentHash, dereferenceSource } from './benjing-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

const statePath = process.argv[2] || path.join(ROOT, 'demo/task1/task.origin.json');

function main() {
  if (!fs.existsSync(statePath)) { console.error('❌ 状态文件不存在:', statePath); process.exit(1); }

  let s;
  try { s = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch (e) { console.error('❌ 状态文件解析失败:', e.message); process.exit(1); }

  const report = { id: s.id, passed: [], failed: [], missing: [] };

  // CHECK 1: artifacts 真实存在
  // 基准路径曾只按状态文件所在目录解析，导致对所有仓库根相对的 artifact 一律误报缺失
  // （实测：task2 三个磁盘上存在的文件全被判缺失）。协议未规定基准，故两个基准都试。
  const stateDir = path.dirname(path.resolve(statePath));
  for (const a of (s.artifacts || [])) {
    if (path.isAbsolute(a)) {
      if (fs.existsSync(a)) report.passed.push(`artifact存在: ${a}`);
      else report.failed.push(`artifact缺失: ${a}`);
      continue;
    }
    const fromRoot = path.resolve(ROOT, a);
    const fromState = path.resolve(stateDir, a);
    if (fs.existsSync(fromRoot)) report.passed.push(`artifact存在: ${a}`);
    else if (fs.existsSync(fromState)) report.passed.push(`artifact存在: ${a} (相对状态文件目录)`);
    else report.failed.push(`artifact缺失: ${a}`);
  }

  // CHECK 2: verified facts 的 source 必须可复核（本境 v0.2）
  // v0.1 这里只判 source 字段非空——实测把 9 条 source 全换成「我说的，不信拉倒」，
  // 判决依然 ✅ VERIFIED。那是存在性检查冒充验证，跟影核 v0.1 的自证式 result 同一个病。
  // v0.2 判「引没引可复核物」（文件/命令/验证用例编号），不判「可复核物现在还在不在」——
  // 因为不少 fact 描述的恰恰是「文件被删了」，要求路径存在会把真事实判成假。
  for (const f of (s.facts || [])) {
    if (!f.verified) continue;
    const rc = recheckSource(f.source);
    if (rc.ok) report.passed.push(`fact source 可复核[${rc.kind}]: ${f.claim.slice(0,26)}`);
    else report.failed.push(`fact source ${rc.kind}（${rc.hint}）: ${f.claim.slice(0,34)}`);

    // CHECK 2b: 解引用——引的东西还在不在。**不翻判决**（B3.3 锁死了「文件没了不等于事实假」），
    // 只把依据摆出来。催生它的那次：另一会话删掉 run-final*.log，六条 source 当场悬空而 CHECK2 全绿。
    const d = dereferenceSource(f.source, ROOT);
    if (d.missing.length) {
      const rerun = String(rc.kind || '').match(/command|testcase/);
      report.missing.push(rerun
        ? `提示: source 引用物已不在（${d.missing.join(', ')}），但同一条 source 还引了可重跑的${rerun[0]}——证据仍可到达: ${f.claim.slice(0,24)}`
        : `⚠ source 悬空（${d.missing.join(', ')}）且路径是这条证据里唯一的可复核物，现在无法到达: ${f.claim.slice(0,24)}`);
    }
  }

  // CHECK 3: next_steps 自洽性——current_state 提到"完成"的不能还在 next_steps
  const cs = s.current_state || '';
  const completedMentions = cs.includes('完成') || cs.includes('验收通过') || cs.includes('绿');
  if (completedMentions && (s.next_steps || []).length > 0) {
    // 可能已完成但还有后续，不武断判失败，给 warning
    report.missing.push(`提示: current_state 似已完成，但 next_steps 仍有 ${s.next_steps.length} 项`);
  }

  // CHECK 4: content_hash 与实际内容对账（本境 v0.2）
  // 实测：另一个会话往 task3 追加了 4 条已验证事实，version 仍是 1、updated_at 仍是旧值。
  // 版本号说不出「状态变没变」，指纹能。指纹对不上 = 有人绕过 benjing-put 改过这份学历。
  if (s.content_hash) {
    const computed = contentHash(s);
    if (computed === s.content_hash) report.passed.push('content_hash 与盘上内容一致');
    else report.missing.push(`content_hash 与内容不符（自记 ${String(s.content_hash).slice(0,12)} vs 实算 ${computed.slice(0,12)}）：有人绕过 benjing-put 改过，或尚未 reconcile`);
  } else {
    report.missing.push('无 content_hash（v0.1 遗留状态，跑一次 SessionEnd 或 benjing-put 即补上）');
  }

  // SUMMARY
  const total = report.passed.length + report.failed.length;
  console.log(`\n═══ VERIFY: ${s.id} ═══`);
  console.log(`目标: ${s.goal || '(无)'}`);
  console.log(`current_state: ${s.current_state || '(无)'}\n`);
  console.log(`✅ 通过 ${report.passed.length} 项:`);
  report.passed.forEach(x => console.log(`   • ${x}`));
  if (report.failed.length) {
    console.log(`\n❌ 失败 ${report.failed.length} 项:`);
    report.failed.forEach(x => console.log(`   • ${x}`));
  }
  if (report.missing.length) {
    console.log(`\n⚠️ 待确认 ${report.missing.length} 项:`);
    report.missing.forEach(x => console.log(`   • ${x}`));
  }

  const verdict = report.failed.length === 0 ? '✅ VERIFIED (通过现实观察确认)' : '❌ NOT VERIFIED';
  console.log(`\n判决: ${verdict}`);
  process.exit(report.failed.length === 0 ? 0 : 1);
}

main();
