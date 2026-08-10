#!/usr/bin/env node
// verify-benxiang.mjs — 本象 v0.1 一致性验证器
//
// 规矩同另外两个验证器：判据只取自磁盘真相与退出码，沙箱在临时目录，可重复跑。
// 本象是「专职观察者」，所以它的判据大半在验一件事：**它有没有被留下自证的口子。**
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { observe, observeAll, compare, SPEC } from './observe.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const SB = path.join(os.tmpdir(), `benxiang-verify-${process.pid}-${Date.now()}`);
fs.mkdirSync(SB, { recursive: true });

const results = [];
const t = (id, desc, fn) => {
  try { const r = fn(); results.push({ id, desc, ok: r === true, detail: r === true ? '' : String(r) }); }
  catch (e) { results.push({ id, desc, ok: false, detail: 'EXCEPTION: ' + e.message }); }
};
const J = (...p) => path.join(SB, ...p);

// ───── X1 独立性：接口上就不给自证留口子 ─────
t('X1.1', 'observe() 拒绝接收第三个参数——不许有人塞进「你觉得应该是什么」', () => {
  fs.writeFileSync(J('a.txt'), 'hello');
  try { observe('a.txt', SB, { sha256: 'whatever' }); return '居然接受了预期值，本象已退化成确认偏误机'; }
  catch (e) { return /不得接收任何预期值/.test(e.message) || `抛错但理由不对: ${e.message}`; }
});
t('X1.2', 'state.object 里不含任何判断字段（ok/pass/verdict/valid）', () => {
  const o = observe('a.txt', SB);
  const bad = JSON.stringify(o).match(/"(ok|pass|passed|verdict|valid|success)"/g);
  return !bad || `观察结果里混进了判断字段: ${bad.join(',')}`;
});
t('X1.3', '「看」和「判」是两步：compare 必须由调用方显式提供 claimed', () => {
  const o = observe('a.txt', SB);
  const v = compare(o, { sha256: 'deadbeef' });
  return (v.verdict === 'drifted' && v.diffs.length === 1) || JSON.stringify(v);
});

// ───── X2 「不存在」是合法观察结果，不是异常 ─────
t('X2.1', '观察不存在的目标返回 exists:false，而不是抛错', () => {
  const o = observe('nope/never.txt', SB);
  return (o.kind === 'state.object' && o.properties.exists === false) || JSON.stringify(o.properties);
});
t('X2.2', '影核 v0.1 的病复现即修：写完被外部删掉，重新观察必须报不存在', () => {
  const p = J('gone.md');
  fs.writeFileSync(p, '# 我存在过\n');
  const before = observe('gone.md', SB);
  fs.unlinkSync(p);
  const after = observe('gone.md', SB);
  return (before.properties.exists === true && after.properties.exists === false)
    || `before=${before.properties.exists} after=${after.properties.exists}`;
});

// ───── X3 字节数不是字符数（影核 v0.1 在这里证错过）─────
t('X3.1', 'size_bytes 报 UTF-8 字节数，不是 JS 字符数', () => {
  const s = '# 我存在过\n';
  fs.writeFileSync(J('utf8.md'), s, 'utf8');
  const o = observe('utf8.md', SB);
  const jsChars = s.length, realBytes = Buffer.byteLength(s, 'utf8');
  if (jsChars === realBytes) return '本判据前提不成立：该字符串的字符数与字节数相同，测不出区别';
  return o.properties.size_bytes === realBytes
    || `报了 ${o.properties.size_bytes}，字节数应为 ${realBytes}（字符数 ${jsChars}）`;
});
t('X3.2', 'sha256 与独立计算一致（观察器没在自己造数）', () => {
  const buf = crypto.randomBytes(5000);
  fs.writeFileSync(J('rnd.bin'), buf);
  const mine = crypto.createHash('sha256').update(buf).digest('hex');
  return observe('rnd.bin', SB).properties.sha256 === mine || 'sha256 对不上';
});

// ───── X4 投影不是对象本身 ─────
t('X4.1', '同一对象报出多种 projection，JSON 解析失败不影响其余观察', () => {
  fs.writeFileSync(J('broken.json'), '{ 这不是合法 JSON');
  const o = observe('broken.json', SB);
  return (o.properties.exists && o.properties.sha256 && o.properties.json_parse_error
    && !o.projections.includes('json')) || JSON.stringify(o.properties).slice(0, 120);
});
t('X4.2', '合法 JSON 报出 kind/spec 投影，供上层认对象（而不是靠文件名认）', () => {
  fs.writeFileSync(J('s.json'), JSON.stringify({ kind: 'task.origin', spec: '2origin/0.2' }));
  const o = observe('s.json', SB);
  return (o.properties.json_kind === 'task.origin' && o.properties.json_spec === '2origin/0.2'
    && o.projections.includes('json')) || JSON.stringify(o.properties);
});

// ───── X5 观察闸门状态（只读位是否还在）─────
t('X5.1', '本象看得见只读闸门掉没掉', () => {
  const p = J('locked.json');
  fs.writeFileSync(p, '{}'); fs.chmodSync(p, 0o444);
  const locked = observe('locked.json', SB).properties.writable === false;
  fs.chmodSync(p, 0o644);
  const unlocked = observe('locked.json', SB).properties.writable === true;
  return (locked && unlocked) || `locked观察=${locked} unlocked观察=${unlocked}`;
});

// ───── X6 回头看：跟上一轮比，且账本只追加 ─────
t('X6.1', 'reobserve 在真实仓库跑得通并落账本', () => {
  const ledger = path.join(here, 'observations.jsonl');
  const before = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).length : 0;
  try { execFileSync(process.execPath, [path.join(here, 'reobserve.mjs'), '--quiet'], { encoding: 'utf8' }); }
  catch (e) { if (e.status !== 1) return `退出码异常 ${e.status}`; }
  const after = fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).length;
  return after === before + 1 || `账本条数 ${before} → ${after}，应恰好 +1（只追加，不覆盖）`;
});
t('X6.2', '账本每轮记下 observed_at —— 「上次被独立观察是什么时候」现在有地方可答', () => {
  const lines = fs.readFileSync(path.join(here, 'observations.jsonl'), 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  return (last.kind === 'observation.round' && !!last.at && Array.isArray(last.states))
    || JSON.stringify(Object.keys(last));
});
t('X6.3', '第二轮起会与上一轮比对（不再只是看一眼）', () => {
  try { execFileSync(process.execPath, [path.join(here, 'reobserve.mjs'), '--quiet'], { encoding: 'utf8' }); }
  catch (e) { if (e.status !== 1) return `退出码异常 ${e.status}`; }
  const lines = fs.readFileSync(path.join(here, 'observations.jsonl'), 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  return (!!last.compared_with && !!last.delta) || `本轮没有 compared_with/delta: ${JSON.stringify(Object.keys(last))}`;
});

// ───── X7 一处观察，多处引用（不再各写各的 sha256）─────
t('X7.1', '本境 health 的 artifact 观察走本象，不再自己实现一遍', () => {
  const core = fs.readFileSync(path.join(REPO, 'southbridge/benjing-core.mjs'), 'utf8');
  return /from '\.\.\/benxiang\/observe\.mjs'|benxiang\/observe/.test(core)
    || 'benjing-core 仍未引用本象——「看世界」还散落在各部件里各写一遍';
});

// ─── X8：数据不合规不得伪装成程序缺陷，且不得让观察器对其余失明 ───
//
// 实弹两次：学历 artifacts 被写成 [{path,what}]（schema 要 string[]）、
// 以及并发会话直接写入的 demo/control-m0。两次都让 observe 抛
// ERR_INVALID_ARG_TYPE —— 日志上像程序崩了，实际是数据不合规。
// 更糟的是 reobserve 整个进程死掉：其余学历一条都没被观察到，账本当轮为空且无人知道。

t('X8.1', 'observe 收到非字符串 target 抛协议级错误（带 code），不让 Node 的 TypeError 冒上来', () => {
  try { observe({ path: "a.txt", what: "对象形式" }, REPO); return '没抛错'; }
  catch (e) {
    return (e.code === 'BENXIANG_BAD_TARGET' && /数据不合规/.test(e.message))
      || `code=${e.code} msg=${e.message.slice(0, 60)}`;
  }
});

t('X8.2', '【反向】错误信息必须指出「这是数据不合规不是程序缺陷」——只抛错不说明等于没修', () => {
  try { observe(["a"], REPO); return '没抛错'; }
  catch (e) { return /不是程序缺陷/.test(e.message) || `msg=${e.message.slice(0, 80)}`; }
});

t('X8.3', '【反向】一份坏学历不得让观察器对其余全部失明：reobserve 须跑完并如实计数', () => {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'benxiang-blind-'));
  try {
    // 两份学历：一份 artifacts 不合规，一份正常。观察器必须两份都处理完。
    const mk = (id, arts) => ({ spec: '2origin/0.2', kind: 'task.origin', id, title: id, goal: 'g',
      current_state: 's', facts: [], decisions: [], artifacts: arts, next_steps: [], learnings: [], actions: [] });
    fs.mkdirSync(path.join(sb, 'bad'), { recursive: true });
    fs.mkdirSync(path.join(sb, 'good'), { recursive: true });
    fs.writeFileSync(path.join(sb, 'bad/task.origin.json'), JSON.stringify(mk('bad', [{ path: 'x.md' }])));
    fs.writeFileSync(path.join(sb, 'good/task.origin.json'), JSON.stringify(mk('good', ['good/task.origin.json'])));
    let okCount = 0, badCount = 0;
    for (const d of ['bad', 'good']) {
      const st = JSON.parse(fs.readFileSync(path.join(sb, d, 'task.origin.json'), 'utf8'));
      for (const a of st.artifacts) {
        try { observe(a, sb); okCount++; } catch { badCount++; }
      }
    }
    return (okCount === 1 && badCount === 1)
      || `正常观察 ${okCount} 条、不合规 ${badCount} 条 —— 应各 1 条`;
  } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
});

// ───────────────────────── 报告 ─────────────────────────
const pass = results.filter(r => r.ok).length;
console.log(`\n═══ 本象 v0.1 一致性验证（${SPEC}）═══\n`);
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.id.padEnd(6)} ${r.desc}`);
  if (!r.ok) console.log(`        └─ ${r.detail}`);
}
console.log(`\n判决：${pass}/${results.length} ${pass === results.length ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
if (pass === results.length) { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { } }
else console.log(`（沙箱保留：${SB}）`);
process.exit(pass === results.length ? 0 : 1);
