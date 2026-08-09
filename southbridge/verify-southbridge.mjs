// verify-southbridge.mjs — 影核 v0.2 一致性验证器
//
// 每条测试都绑定一个「v0.1 已实测的故障」，不是抽象规范检查。
// 判据全部来自磁盘真相，不来自工具的自述。
// 跑法：node southbridge/verify-southbridge.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const SERVER = path.join(here, 'southbridge-mcp.mjs');
const CLI = path.join(here, 'southbridge-cli.mjs');
const SANDBOX = path.join(ROOT, 'demo', '_verify');

// CLI 驱动：stdout 一行 JSON，退出码可判
function cli(args, stdin = '', env = {}) {
  const p = spawnSync(process.execPath, [CLI, ...args], {
    input: stdin, encoding: 'utf8', env: { ...process.env, ...env }
  });
  let result = null;
  try { result = JSON.parse(p.stdout.trim().split('\n').pop()); } catch { /* 用法错时无 JSON */ }
  return { result, code: p.status, stderr: p.stderr };
}

// 并发跑 CLI：验证账本在多进程同时写时不丢记录（本机多会话并发是常态）
function cliAsync(args, env = {}) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('close', code => {
      let result = null;
      try { result = JSON.parse(out.trim().split('\n').pop()); } catch { /* ignore */ }
      resolve({ result, code });
    });
  });
}

// 比对两条通道的判决：排除天然不同的字段（动作 ID、目标路径、时间戳）
function decision(r) {
  if (!r) return null;
  const { action_id, target, evidence, state_diff, backup_path, undo_hint, mtime, ...rest } = r;
  return JSON.stringify({
    ...rest,
    evidence: evidence ? { exists: evidence.exists, size_bytes: evidence.size_bytes, sha256: evidence.sha256 } : null,
    state_diff: state_diff ?? null,
    has_backup: !!backup_path
  });
}

// 一次会话发多条请求，收集结构化 action.result
function rpc(calls) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', d => { out += d.toString('utf8'); });
    p.on('close', () => {
      const results = out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
        .filter(r => r.id !== 1)
        .map(r => { try { return JSON.parse(r.result.content[0].text); } catch { return r.result; } });
      resolve(results);
    });
    p.on('error', reject);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    calls.forEach((c, i) => {
      p.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: i + 2, method: 'tools/call',
        params: { name: c.tool || 'southbridge_write', arguments: c.args }
      }) + '\n');
    });
    p.stdin.end();
  });
}

const rel = f => path.relative(ROOT, path.join(SANDBOX, f)).replace(/\\/g, '/');
const abs = f => path.join(SANDBOX, f);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const report = { pass: [], fail: [] };
function check(name, cond, detail) {
  (cond ? report.pass : report.fail).push(`${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });

  // ═══ T1：evidence 可翻案（对应实测故障①：写完外部删除，审计仍说 done）═══
  {
    const [w] = await rpc([{ args: { relpath: rel('t1.md'), content: '# 我存在过\n', mode: 'write' } }]);
    check('T1.1 写动作产出 evidence.sha256', !!w.evidence?.sha256, `status=${w.status}`);
    check('T1.2 size_bytes 是 UTF-8 字节数不是字符数',
      w.evidence?.size_bytes === Buffer.byteLength('# 我存在过\n', 'utf8'),
      `报 ${w.evidence?.size_bytes}，应为 ${Buffer.byteLength('# 我存在过\n', 'utf8')}（v0.1 报 7）`);

    fs.rmSync(abs('t1.md'));   // 外部把世界改回去
    const [v] = await rpc([{ tool: 'southbridge_verify', args: { relpath: rel('t1.md'), expect_sha256: w.evidence.sha256 } }]);
    check('T1.3 文件被外部删除后能翻案为 failed', v.status === 'failed' && v.verdict === 'missing', `verdict=${v.verdict}`);
  }

  // ═══ T2：幂等（对应实测故障②：同一 append 重放两次写了两行）═══
  // key 每次跑都唯一，否则验证器自己被上一轮账本污染——这本身就是第一轮发现的问题。
  {
    const KEY = 'k-t2-' + crypto.randomUUID().slice(0, 8);
    const a = { relpath: rel('t2.txt'), content: 'LINE\n', mode: 'append', idempotency_key: KEY };
    const [r1, r2] = await rpc([{ args: a }, { args: a }]);
    const lines = fs.existsSync(abs('t2.txt')) ? fs.readFileSync(abs('t2.txt'), 'utf8').split('\n').filter(Boolean).length : 0;
    check('T2.1 首次写 done', r1.status === 'done', `status=${r1.status}`);
    check('T2.2 同 key 重放标记 replayed', r2.status === 'replayed', `status=${r2.status}`);
    check('T2.3 磁盘只有一行（世界没被写第二次）', lines === 1, `实际 ${lines} 行（v0.1 是 2 行）`);

    const [r3] = await rpc([{ args: { ...a, content: 'DIFFERENT\n' } }]);
    check('T2.4 同 key 换请求被拒（key 冲突）', r3.status === 'denied', `status=${r3.status}`);

    // T2.5：账本不得自证——第一轮验证时发现的缺陷，幂等账本自己变成了新的"声明与现实脱节"
    fs.rmSync(abs('t2.txt'));                       // 外部把世界改回去
    const [r4] = await rpc([{ args: a }]);
    check('T2.5 账本命中但磁盘已变 → diverged 而非 replayed',
      r4.status === 'diverged' && r4.evidence?.exists === false, `status=${r4.status}`);
  }

  // ═══ T3：风险分级 + 两种批准（对应实测故障③：授权一刀切，无头 harness 拿不到有限写权）═══
  {
    const [low] = await rpc([{ args: { relpath: rel('t3.md'), content: 'v1\n', mode: 'write' } }]);
    check('T3.1 新建=low，自动放行', low.risk === 'low' && low.approval === 'auto' && low.status === 'done', `risk=${low.risk}`);

    const [med] = await rpc([{ args: { relpath: rel('t3.md'), content: 'v2\n', mode: 'write' } }]);
    check('T3.2 覆盖=medium，无凭据被拦', med.risk === 'medium' && med.status === 'requires_approval', `status=${med.status}`);
    check('T3.3 被拦后磁盘未变', fs.readFileSync(abs('t3.md'), 'utf8') === 'v1\n');

    const [ok] = await rpc([{ args: { relpath: rel('t3.md'), content: 'v2\n', mode: 'write', expect_sha256: sha('v1\n') } }]);
    check('T3.4 正确 expect_sha256 放行（无头 harness 的批准方式）',
      ok.status === 'done' && ok.approval === 'expect_sha256', `status=${ok.status}`);
    check('T3.5 覆盖留下备份（reversible 有物证）',
      !!ok.backup_path && fs.existsSync(path.join(ROOT, ok.backup_path)), `backup=${ok.backup_path}`);

    const [stale] = await rpc([{ args: { relpath: rel('t3.md'), content: 'v3\n', mode: 'write', expect_sha256: sha('v1\n') } }]);
    check('T3.6 过期 expect_sha256 被拒（防静默覆盖）', stale.status === 'requires_approval', `status=${stale.status}`);
  }

  // ═══ T4：受保护路径必须显式确认（学历文件不能被乐观锁顺手覆盖）═══
  {
    fs.writeFileSync(abs('task.origin.json'), '{"spec":"2origin/0.1"}\n', 'utf8');
    const [hi] = await rpc([{ args: { relpath: rel('task.origin.json'), content: '{}\n', mode: 'write' } }]);
    check('T4.1 覆盖 task.origin.json = high risk', hi.risk === 'high' && hi.status === 'requires_approval', `risk=${hi.risk}`);

    const [conf] = await rpc([{ args: { relpath: rel('task.origin.json'), content: '{}\n', mode: 'write', approval: 'confirm' } }]);
    check('T4.2 显式 confirm 后放行', conf.status === 'done' && conf.approval === 'confirm', `status=${conf.status}`);
  }

  // ═══ T5：白名单硬边界仍在（v0.1 唯一做对的事，不能回退）═══
  {
    const [d] = await rpc([{ args: { relpath: 'evil/../shadow.txt', content: 'x', mode: 'write' } }]);
    check('T5.1 白名单外路径穿越被拒', d.status === 'denied' && d.risk === 'denied', `status=${d.status}`);
    check('T5.2 未在根目录留下文件', !fs.existsSync(path.join(ROOT, 'shadow.txt')));
  }

  // ═══ T6：一核多影 —— 同一动作走 MCP / CLI 两条通道必须得到同一判决 ═══
  // 这是 ActionParity 的字面主张。抽核心的理由是实测（MCP 通道被 harness 审批闸门
  // 整体堵死，audit.log 零记录），不是对称美——所以 parity 必须被验证，不能靠"共用了同一个函数"自证。
  {
    // 场景 1：low —— 新建文件
    const [m1] = await rpc([{ args: { relpath: rel('t6-mcp-a.md'), content: '同一份内容\n', mode: 'write' } }]);
    const c1 = cli(['write', '--relpath', rel('t6-cli-a.md'), '--content-file', '-'], '同一份内容\n');
    check('T6.1 low 场景两条通道判决一致', decision(m1) === decision(c1.result),
      `mcp=${m1.status}/${m1.risk} cli=${c1.result?.status}/${c1.result?.risk}`);
    check('T6.2 CLI done 退出码为 0', c1.code === 0, `code=${c1.code}`);

    // 场景 2：medium —— 覆盖已存在文件且不出示凭据
    const [m2] = await rpc([{ args: { relpath: rel('t6-mcp-a.md'), content: '改写\n', mode: 'write' } }]);
    const c2 = cli(['write', '--relpath', rel('t6-cli-a.md'), '--content-file', '-'], '改写\n');
    check('T6.3 medium 拦截两条通道判决一致', decision(m2) === decision(c2.result),
      `mcp=${m2.status} cli=${c2.result?.status}`);
    check('T6.4 CLI requires_approval 退出码为 2', c2.code === 2, `code=${c2.code}`);
    check('T6.5 两条通道被拦后磁盘都没变',
      fs.readFileSync(abs('t6-mcp-a.md'), 'utf8') === '同一份内容\n' &&
      fs.readFileSync(abs('t6-cli-a.md'), 'utf8') === '同一份内容\n');

    // 场景 3：denied —— 白名单外，硬边界在两条通道上同样硬
    const [m3] = await rpc([{ args: { relpath: 'evil/../shadow-mcp.txt', content: 'x', mode: 'write' } }]);
    const c3 = cli(['write', '--relpath', 'evil/../shadow-cli.txt', '--content', 'x']);
    check('T6.6 denied 两条通道判决一致', decision(m3) === decision(c3.result),
      `mcp=${m3.status} cli=${c3.result?.status}`);
    check('T6.7 CLI denied 退出码为 3', c3.code === 3, `code=${c3.code}`);

    // CLI 专有：stdout 必须只有机器可读 JSON（当本地 API 用的前提）
    const c4 = cli(['verify', '--relpath', rel('t6-cli-a.md')]);
    check('T6.8 CLI stdout 是可解析 action.result', !!c4.result?.evidence?.sha256, `verdict=${c4.result?.verdict}`);
    check('T6.9 CLI 审计写入 actor=southbridge_cli（通道可追溯）',
      fs.readFileSync(path.join(here, 'audit.log'), 'utf8').includes('"actor":"southbridge_cli"'));

    // T6.10：内容来源必须显式。实测 footgun——漏给 content 会静默写出 0 字节文件并报 done，
    // 且完全符合"写后观察一致"，验证器抓不出来。只能在入口拦。
    const c5 = cli(['write', '--relpath', rel('t6-footgun.md')]);
    check('T6.10 缺内容来源被拒为用法错，且不留空文件',
      c5.code === 1 && !fs.existsSync(abs('t6-footgun.md')), `code=${c5.code}`);
    const c6 = cli(['write', '--relpath', rel('t6-empty.md'), '--content', '']);
    check('T6.11 显式 --content \'\' 才写空文件',
      c6.code === 0 && fs.existsSync(abs('t6-empty.md')) && fs.statSync(abs('t6-empty.md')).size === 0, `code=${c6.code}`);
  }

  // ═══ T7：Trust 加固 —— 审计 fail-closed + 账本并发安全（RFC §6.2 / §6.4）═══
  {
    // T7.1 审计写不进去就不许动世界。用目录当审计路径制造 EISDIR。
    const badAudit = path.join(SANDBOX, 'audit-is-a-dir');
    fs.mkdirSync(badAudit, { recursive: true });
    const c1 = cli(['write', '--relpath', rel('t7-blocked.md'), '--content', 'x'],
      '', { SHADOWCORE_AUDIT_LOG: badAudit });
    check('T7.1 审计不可写 → 拒绝执行（fail-closed）',
      c1.result?.status === 'denied' && c1.result?.audit === 'unavailable', `status=${c1.result?.status}`);
    check('T7.2 被拒时世界未被改动（没留下文件）', !fs.existsSync(abs('t7-blocked.md')));

    const c2 = cli(['write', '--relpath', rel('t7-blocked.md'), '--content', 'x']);
    check('T7.3 审计恢复后同一动作正常执行', c2.result?.status === 'done', `status=${c2.result?.status}`);

    // T7.4 并发写账本不丢记录。v0.2 初版是整体读改写，N 个进程同时写只会剩最后一个。
    const LEDGER = path.join(SANDBOX, 'ledger.jsonl');
    const N = 8;
    const runs = await Promise.all(Array.from({ length: N }, (_, i) =>
      cliAsync(['write', '--relpath', rel(`t7-c${i}.md`), '--content', `c${i}`, '--idempotency-key', `t7-key-${i}`],
        { SHADOWCORE_LEDGER: LEDGER })));
    const okRuns = runs.filter(r => r.result?.status === 'done').length;
    const keys = new Set(fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l).key; } catch { return null; } }).filter(Boolean));
    check(`T7.4 ${N} 个进程并发写，账本一条不丢`, okRuns === N && keys.size === N,
      `落盘 ${okRuns}/${N}，账本 ${keys.size}/${N} 条`);

    // T7.5 并发写完后幂等仍然成立（重放不再动世界）
    const replay = cli(['write', '--relpath', rel('t7-c0.md'), '--content', 'c0', '--idempotency-key', 't7-key-0'],
      '', { SHADOWCORE_LEDGER: LEDGER });
    check('T7.5 并发写入的账本记录仍能命中 replayed', replay.result?.status === 'replayed', `status=${replay.result?.status}`);

    // T7.6 账本超上限自动压缩，且压缩后老 key 仍命中
    const smallLedger = path.join(SANDBOX, 'ledger-small.jsonl');
    for (let i = 0; i < 6; i++) {
      cli(['write', '--relpath', rel(`t7-s${i}.md`), '--content', `s${i}`, '--idempotency-key', `t7-s-${i}`],
        '', { SHADOWCORE_LEDGER: smallLedger, SHADOWCORE_LEDGER_MAX: '3' });
    }
    const lines = fs.readFileSync(smallLedger, 'utf8').split('\n').filter(Boolean).length;
    const afterCompact = cli(['write', '--relpath', rel('t7-s5.md'), '--content', 's5', '--idempotency-key', 't7-s-5'],
      '', { SHADOWCORE_LEDGER: smallLedger, SHADOWCORE_LEDGER_MAX: '3' });
    check('T7.6 账本超上限被压缩（不再无限增长）', lines <= 4, `压缩后 ${lines} 行（上限 3）`);
    check('T7.7 压缩后最近的 key 仍能命中 replayed', afterCompact.result?.status === 'replayed',
      `status=${afterCompact.result?.status}`);
  }

  // ═══ T8：追加写的幂等看 footprint，不看整文件快照（RFC §6.3）═══
  // 实测缺陷：别人往同一日志追加 → 整文件 sha 变 → 我原样重试被判 diverged →
  // 调用方按退出码 4 重试 → 同一段被写两次。幂等机制诱发了它本要防的重复写。
  // 复现（修复前 2/2 场景中招）：node southbridge/probe-append-idempotency.mjs
  {
    const KEY = 'k-t8-' + crypto.randomUUID().slice(0, 8);
    const a = { relpath: rel('t8.log'), content: 'A的记录\n', mode: 'append', idempotency_key: KEY };

    const [w1] = await rpc([{ args: a }]);
    check('T8.1 追加动作产出 footprint（偏移+长度+该段 sha）',
      w1.footprint?.length === Buffer.byteLength('A的记录\n', 'utf8') && !!w1.footprint?.sha256,
      `footprint=${JSON.stringify(w1.footprint)}`);
    check('T8.2 覆盖写不产 footprint（其语义本就是整文件）',
      (await rpc([{ args: { relpath: rel('t8-w.md'), content: 'v\n', mode: 'write' } }]))[0].footprint === undefined);

    fs.appendFileSync(abs('t8.log'), 'B的记录\n', 'utf8');   // 另一个 harness 合法地继续追加
    const [w2] = await rpc([{ args: a }]);
    check('T8.3 他人追加后原样重试仍判 replayed（不再误判 diverged）',
      w2.status === 'replayed', `status=${w2.status}`);
    check('T8.4 replayed 的 evidence 是此刻观察，不是首次动作的旧快照',
      w2.evidence?.sha256 === sha('A的记录\nB的记录\n'), `evidence.sha256=${w2.evidence?.sha256?.slice(0, 12)}`);
    const body = fs.readFileSync(abs('t8.log'), 'utf8');
    check('T8.5 重试没有把内容写第二遍',
      body === 'A的记录\nB的记录\n', JSON.stringify(body));

    // 反向判据：footprint 被真的破坏时必须仍判 diverged，别把校验放水成永远通过
    fs.writeFileSync(abs('t8.log'), 'X的记录\nB的记录\n', 'utf8');   // 原位那段被改写
    const [w3] = await rpc([{ args: a }]);
    check('T8.6 我那段被改写 → 仍判 diverged',
      w3.status === 'diverged' && w3.footprint_observed?.present === true, `status=${w3.status}`);

    fs.writeFileSync(abs('t8.log'), '短\n', 'utf8');                  // 文件被截断到 footprint 之外
    const [w4] = await rpc([{ args: a }]);
    check('T8.7 文件被截断 → 仍判 diverged',
      w4.status === 'diverged' && w4.footprint_observed?.present === false, `status=${w4.status}`);
  }

  // ── 判决
  console.log(`\n═══ VERIFY: 影核协议 v0.2 (shadowcore/0.2) ═══\n`);
  console.log(`✅ 通过 ${report.pass.length} 项:`);
  report.pass.forEach(x => console.log(`   • ${x}`));
  if (report.fail.length) {
    console.log(`\n❌ 失败 ${report.fail.length} 项:`);
    report.fail.forEach(x => console.log(`   • ${x}`));
  }
  const verdict = report.fail.length === 0 ? '✅ VERIFIED（每条判据取自磁盘真相）' : '❌ NOT VERIFIED';
  console.log(`\n判决: ${verdict}\n`);

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(report.fail.length === 0 ? 0 : 1);
}

main();
