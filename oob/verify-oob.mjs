#!/usr/bin/env node
// verify-oob.mjs — 带外观察面 v0.1 一致性验证器
//
// 本仓库的规矩（RFC-0000 §12.5-2）：**每条判据必须配一个反向用例——故意造假，必须被抓住。**
// 只有正向用例的判据，测的是"实现有没有跑"，不是"判据成不成立"。
// 一个永远说 ok 的健康探针比没有探针更坏：它会让人以为已经看过了。
//
// 所以下面 O2/O3/O4/O5/O6 全部是主动制造故障，断言探针**必须报出来**。
// 跑法：node oob/verify-oob.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProbes, diffAgainst, snapshot, summaryLine } from './env-probe.mjs';
import { reconcileArtifacts, parseBootClaim } from './crosscheck.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROBE = path.join(here, 'env-probe.mjs');
const SANDBOX = path.join(os.tmpdir(), `oob-verify-${process.pid}`);
fs.mkdirSync(SANDBOX, { recursive: true });

const pass = [], fail = [];
let reverseCount = 0;
// kind='rev' 表示这是反向用例（主动造假，必须被抓住）。计数由这里算，不手写在判决行里——
// 手写的数字会跟现实脱节，那正是本仓库的头号病（bundle 谎报装载量、RFC 里过期的 36/36）。
const check = (n, ok, d, kind = 'rev') => {
  if (kind === 'rev') reverseCount++;
  (ok ? pass : fail).push(`${n}${d ? ' — ' + d : ''}`);
};

// 跑探针子进程，env 可注入故障。返回 {snap, code}
function run(env = {}) {
  const r = spawnSync(process.execPath, [PROBE], {
    encoding: 'utf8', env: { ...process.env, OOB_LOG: path.join(SANDBOX, 'env.jsonl'), ...env }
  });
  let snap = null;
  try { snap = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { /* null */ }
  return { snap, code: r.status };
}

// ═══ O1 正向：三个探针在健康环境下都通过 ═══
{
  const { snap, code } = run();
  check('O1.1 三个探针全部产出确定判决',
    snap && ['spawn', 'write_path', 'harness'].every(k => ['ok', 'fail', 'unknown'].includes(snap.probes?.[k]?.verdict)),
    snap ? Object.entries(snap.probes).map(([k, v]) => `${k}=${v.verdict}`).join(' ') : '无输出', 'fwd');
  check('O1.2 健康环境下退出码为 0', code === 0, `code=${code}`, 'fwd');
  check('O1.3 write_path 不采信南桥自报，独立回读磁盘比对',
    /磁盘回读一致/.test(snap?.probes?.write_path?.detail || ''), snap?.probes?.write_path?.detail, 'fwd');
}

// ═══ O2 反向：起不了进程时必须报 fail（这是 case-4 那一行，最重要的一条）═══
{
  const { snap, code } = run({ OOB_SPAWN_BIN: path.join(SANDBOX, 'no-such-binary-xyz') });
  check('O2.1 子进程起不来 → spawn 探针报 fail（不是 ok，也不是静默）',
    snap?.probes?.spawn?.verdict === 'fail', `verdict=${snap?.probes?.spawn?.verdict}`);
  check('O2.2 探针失败时整轮 verdict 为 fail', snap?.verdict === 'fail', `verdict=${snap?.verdict}`);
  check('O2.3 环境不健康时退出码非 0（脚本能发现）', code !== 0, `code=${code}`);
  check('O2.4 失败原因被记下来，不是只有一个 fail 标记',
    (snap?.probes?.spawn?.detail || '').length > 5, snap?.probes?.spawn?.detail);
}

// ═══ O3 反向：南桥被 fail-closed 挡住时，write_path 必须报 fail ═══
// 制造 EISDIR 让南桥审计写不进去 → 南桥按 fail-closed 拒绝执行 → 探针必须看见
{
  const badAudit = path.join(SANDBOX, 'audit-is-a-dir');
  fs.mkdirSync(badAudit, { recursive: true });
  const { snap } = run({ SHADOWCORE_AUDIT_LOG: badAudit });
  check('O3.1 南桥拒绝执行 → write_path 报 fail',
    snap?.probes?.write_path?.verdict === 'fail', `verdict=${snap?.probes?.write_path?.verdict}`);
  check('O3.2 报的是南桥的判决原文，不是笼统"失败"',
    /denied|南桥判决/.test(snap?.probes?.write_path?.detail || ''), snap?.probes?.write_path?.detail);
  check('O3.3 底层 spawn 仍是 ok —— 探针能区分「基质坏了」和「上层坏了」',
    snap?.probes?.spawn?.verdict === 'ok', `spawn=${snap?.probes?.spawn?.verdict}`);
}

// ═══ O4 反向：分歧检测（真相来自分歧，RFC-0002 §4）═══
{
  const now = runProbes();
  const d1 = diffAgainst({ probes: { ...now, spawn: { verdict: 'fail', detail: '假装上次挂了' } } }, now);
  check('O4.1 判决变化被报出来', d1.changed.some(c => /spawn: fail → ok/.test(c)), JSON.stringify(d1.changed));

  const d2 = diffAgainst({ probes: { ...now, harness: { verdict: now.harness.verdict, detail: '上次是别的 harness' } } }, now);
  check('O4.2 判决没变但细节变了也要报（版本漂移就是这样发生的）',
    d2.changed.some(c => /harness: 判决未变但细节变了/.test(c)), JSON.stringify(d2.changed));

  // A4：缺席不会自己发声 —— 探针消失必须被报，不能因为"没人报错"就当没事
  const d3 = diffAgainst({ probes: { ...now, ghost_probe: { verdict: 'ok', detail: 'x' } } }, now);
  check('O4.3 探针消失会被报出来（缺席要发声）',
    d3.changed.some(c => /ghost_probe: 探针消失/.test(c)), JSON.stringify(d3.changed));

  const d4 = diffAgainst(null, now);
  check('O4.4 首次运行如实说「无可比对」，不伪装成「一切正常」',
    d4.first_run === true && d4.changed.length === 0, JSON.stringify(d4));
}

// ═══ O5 反向：自己落盘失败时不许吞（静默即缺陷，含对自身）═══
{
  const badLog = path.join(SANDBOX, 'log-is-a-dir');
  fs.mkdirSync(badLog, { recursive: true });
  const snap = snapshot(badLog);
  check('O5.1 快照写不进日志时，结果里带 log:write-failed（不静默）',
    /write-failed/.test(snap.log || ''), `log=${snap.log}`);
  check('O5.2 落盘失败不影响探针结果本身仍然产出',
    Object.keys(snap.probes || {}).length === 3, `probes=${Object.keys(snap.probes || {}).length}`);
}

// ═══ O6 反向：摘要行不许谎报（bundle 谎报装载量的同型缺陷）═══
{
  const bad = { verdict: 'fail', first_run: false, changed: ['spawn: ok → fail'],
                probes: { spawn: { verdict: 'fail', detail: 'CreateProcessAsUserW failed: 5' },
                          write_path: { verdict: 'ok', detail: 'x' }, harness: { verdict: 'ok', detail: 'y' } } };
  const line = summaryLine(bad);
  check('O6.1 有探针失败时摘要必须是 ⚠ 而不是 ✔', /^⚠/.test(line), line);
  check('O6.2 摘要必须带上失败原因原文，不能只说"有问题"',
    /CreateProcessAsUserW/.test(line), line);
  const good = summaryLine({ verdict: 'ok', first_run: false, changed: [],
    probes: { spawn: { verdict: 'ok', detail: 'a' }, write_path: { verdict: 'ok', detail: 'b' }, harness: { verdict: 'ok', detail: 'c' } } });
  check('O6.3 全通过时不夹带虚假告警', /^✔/.test(good) && !/⚠/.test(good), good, 'fwd');
}

// ═══ O7 对账 X1：辖区必须分清，否则对账器自己就是喊狼来了的那个 ═══
{
  const AUDIT_START = '2026-08-08T08:00:00.000Z';
  const audit = { written: new Set(['demo/has-record.md']), since: AUDIT_START, lines: 9 };
  const after = Date.parse('2026-08-08T10:00:00Z'), before = Date.parse('2026-08-08T06:00:00Z');
  const statAt = (a) => ({
    'demo/has-record.md': { mtimeMs: after },
    'demo/bypassed.md': { mtimeMs: after },
    'demo/old.md': { mtimeMs: before },
    'demo/task9/task.origin.json': { mtimeMs: after },
    'research/x.md': { mtimeMs: after }
  }[a] || null);
  const claims = ['demo/has-record.md', 'demo/bypassed.md', 'demo/old.md',
                  'demo/task9/task.origin.json', 'research/x.md', 'demo/gone.md']
                  .map(artifact => ({ from: 'demo/t/task.origin.json', artifact }));
  const b = reconcileArtifacts(claims, audit, statAt);

  check('O7.1 demo/ 内、晚于审计起点、无记录 → 判 bypassed（真绕过要抓出来）',
    b.bypassed.length === 1 && b.bypassed[0].artifact === 'demo/bypassed.md',
    b.bypassed.map(c => c.artifact).join(','));
  check('O7.2 有审计记录的不误伤', b.matched.length === 1 && b.matched[0].artifact === 'demo/has-record.md');
  check('O7.3 协议外路径不判违规（南桥白名单只管 demo/，喊狼来了是禁止的）',
    b.out_of_scope.length === 1 && b.out_of_scope[0].artifact === 'research/x.md',
    JSON.stringify(b.out_of_scope.map(c => c.artifact)));
  check('O7.4 学历文件归本境辖区，不拿影核的账去查（首轮实测误报过 task1）',
    b.benjing_scope.length === 1 && /task\.origin\.json$/.test(b.benjing_scope[0].artifact),
    JSON.stringify(b.benjing_scope.map(c => c.artifact)));
  check('O7.5 早于审计起点的不判违规（那时协议还不存在）',
    b.predates_audit.length === 1 && b.predates_audit[0].artifact === 'demo/old.md');
  check('O7.6 磁盘上没有的单独归类，不混进 bypassed',
    b.missing.length === 1 && b.missing[0].artifact === 'demo/gone.md');
  check('O7.7 没有审计时（since=null）不把一切都判成绕过',
    reconcileArtifacts(claims, { written: new Set(), since: null, lines: 0 }, statAt).bypassed.length === 3,
    '应为 3 条 demo/ 内可判的');
}

// ═══ O8 对账 X2：boot 自报的数必须能被独立数一遍打脸 ═══
{
  const good = parseBootClaim('磁盘上 8 份学历、110 条已验证事实。当前任务全量装载。');
  check('O8.1 能解析 boot 的计数声明', good?.states === 8 && good?.facts === 110, JSON.stringify(good), 'fwd');
  check('O8.2 解析不出时返回 null，而不是编一个数字出来',
    parseBootClaim('今天天气不错') === null && parseBootClaim('') === null && parseBootClaim(null) === null);
  check('O8.3 数字不同即判不一致（谎报装载量是已复现过的缺陷）',
    parseBootClaim('磁盘上 8 份学历、99 条已验证事实').facts !== good.facts);
}

// ── 判决
console.log(`\n═══ VERIFY: 带外观察面 v0.1 (oob/0.1) ═══\n`);
console.log(`✅ 通过 ${pass.length} 项:`);
pass.forEach(x => console.log(`   • ${x}`));
if (fail.length) { console.log(`\n❌ 失败 ${fail.length} 项:`); fail.forEach(x => console.log(`   • ${x}`)); }
const total = pass.length + fail.length;
console.log(`\n判决: ${fail.length === 0
  ? `✅ VERIFIED（${total} 条判据，其中 ${reverseCount} 条是反向用例：故意造假必须被抓住）`
  : '❌ NOT VERIFIED'}\n`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(fail.length === 0 ? 0 : 1);
