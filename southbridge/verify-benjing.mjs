#!/usr/bin/env node
// verify-benjing.mjs — 本境协议 v0.2 一致性验证器
//
// 规矩同 verify-southbridge.mjs：判据只取自磁盘真相与进程退出码，不采信任何工具的自述；
// 必须可重复跑（每轮用独立沙箱，不被上一轮污染）；沙箱在临时目录，绝不碰真实学历。
//
//   node southbridge/verify-benjing.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  contentHash, recheckSource, dereferenceSource, findStates, putState, reconcile,
  detectActor, observeModel, writeAtomic, health,
  isLocked as isLockedFS, lockState, unlockState, scanStateFiles
} from './benjing-core.mjs';
import { checkState } from './schema-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const SB = path.join(os.tmpdir(), `benjing-verify-${process.pid}-${Date.now()}`);

const results = [];
const t = (id, desc, fn) => {
  try { const r = fn(); results.push({ id, desc, ok: r === true, detail: r === true ? '' : String(r) }); }
  catch (e) { results.push({ id, desc, ok: false, detail: 'EXCEPTION: ' + e.message }); }
};
const J = (...p) => path.join(SB, ...p);
const readJ = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJ = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8'); };
// 模拟「绕过协议的写入者」。只读位挡得住就地修改，挡不住删了重建（实测 sed -i 就是这么穿过去的，
// 且穿完把 mode 恢复成 444）。所以模拟绕过必须走这条真实存在的路径，不能走已被堵死的那条。
const bypassWrite = (p, text) => { const was = isLockedFS(p); if (was) unlockState(p); fs.writeFileSync(p, text, 'utf8'); if (was) lockState(p); };

function mkState(id, over = {}) {
  return {
    spec: '2origin/0.1', kind: 'task.origin', id, title: '任务 ' + id, goal: '目标 ' + id,
    version: 1, updated_at: '2026-08-01T00:00:00Z', current_state: '状态 ' + id,
    next_steps: ['继续 ' + id],
    facts: [{ claim: id + ' 的已验证事实', verified: true, source: `node southbridge/verify-benjing.mjs 跑出 ${id}.log` }],
    ...over
  };
}

// ───────────────────────── 搭沙箱 ─────────────────────────
fs.mkdirSync(J('.claude/hooks'), { recursive: true });
fs.mkdirSync(J('southbridge'), { recursive: true });
// 部件目录整个拷贝：前三次事故都是新增跨部件依赖后沙箱漏拷（benxiang → northbridge）。
// 枚举单个文件的写法必然滞后于依赖增长，改成整目录。
//
// 第五次复发（2026-08-09）：另一会话新增 governance/policy.mjs 并被 northbridge/compile.mjs 引入，
// 沙箱没拷 governance/ ⇒ ERR_MODULE_NOT_FOUND。**改成整目录还不够，因为"哪些目录"仍是枚举的。**
// 这里改成扫仓库根下的部件目录，新增部件不必再回来改这一行；
// 真正的治本是让沙箱按 import 图闭包拷贝，那要单独做（已记入学历 next_steps）。
const PARTS = fs.readdirSync(REPO, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('.') &&
    !['demo', 'node_modules', 'papers', 'rfcs', 'research', 'schemas', 'southbridge', 'hooks'].includes(e.name))
  .map(e => e.name);
for (const d of PARTS) fs.cpSync(path.join(REPO, d), J(d), { recursive: true });
// southbridge 也必须整目录（只拷 .mjs，跳过 audit.log 这类大数据文件）。
// 第四次复发了：上面那条注释说「枚举单个文件的写法必然滞后于依赖增长」，
// 然后只把 benxiang/northbridge 改成了整目录，southbridge 仍在枚举——
// 另一个会话新增 southbridge/schema-check.mjs 并被 benjing-core 引入的当天，
// 整套判据就 ERR_MODULE_NOT_FOUND 挂掉。**只在三处中的两处应用修法，等于没修。**
for (const f of fs.readdirSync(path.join(REPO, 'southbridge')).filter(f => f.endsWith('.mjs'))) {
  fs.copyFileSync(path.join(REPO, 'southbridge', f), J('southbridge', f));
}
fs.copyFileSync(path.join(REPO, '.claude/hooks/load-state.mjs'), J('.claude/hooks/load-state.mjs'));
fs.copyFileSync(path.join(REPO, '.claude/hooks/finalize-state.mjs'), J('.claude/hooks/finalize-state.mjs'));

writeJ(J('demo/taskA/task.origin.json'), mkState('taskA'));
writeJ(J('demo/taskB/task.origin.json'), mkState('taskB'));
writeJ(J('demo/taskC/task.origin.json'), mkState('taskC'));
// 同名的 JSON Schema：v0.1 会把它当成一份学历（缺陷⑥）
writeJ(J('schemas/task.origin.json'), { $schema: 'http://json-schema.org/draft-07/schema#', title: '我是 schema 不是学历', type: 'object' });
const utime = (p, iso) => fs.utimesSync(p, new Date(iso), new Date(iso));
utime(J('demo/taskA/task.origin.json'), '2026-08-01T01:00:00Z');
utime(J('demo/taskB/task.origin.json'), '2026-08-01T02:00:00Z');
utime(J('demo/taskC/task.origin.json'), '2026-08-01T03:00:00Z'); // C 最新 = active
utime(J('schemas/task.origin.json'), '2026-08-01T09:00:00Z');    // schema 故意最新，考验加载器

const runHook = rel => execFileSync(process.execPath, [J(rel)], { encoding: 'utf8' });
const bundle = () => JSON.parse(runHook('.claude/hooks/load-state.mjs')).hookSpecificOutput.additionalContext;

// ───────────── B1 学历装载：不再只读最后一个扇区 ─────────────
const B1 = bundle();

// B1.1/B1.2/B1.3/B1.5/B1.6/B1.7/B1.8 已**搬家**到 northbridge/verify-northbridge.mjs。
// 它们锁的是「开会时装载什么」——那是北桥的职责，不是本境的。北桥 v0.2 把编译拆成
// boot（SessionStart，无 goal）与 request（UserPromptSubmit，有 goal）两个时刻后，
// 旧的「全塞+轮转+丢弃必报」契约整体被 N1/N2/N3 取代。
// **不静默删判据**：下面这条主动确认搬走的那批仍在跑，否则搬家就等于消失。
t('B1.0', '搬到北桥的那批装载判据仍在跑（不许借搬家把判据弄丢）', () => {
  try { execFileSync(process.execPath, [path.join(REPO, 'northbridge/verify-northbridge.mjs')], { encoding: 'utf8' }); return true; }
  catch (e) { return `northbridge 验证器未通过（退出码 ${e.status}）`; }
});
t('B1.4', 'schemas/task.origin.json 不被当成学历（缺陷⑥）——直接测 findStates，不再绕 bundle 文本', () => {
  const found = findStates(SB).map(f => path.relative(SB, f).split(path.sep).join('/'));
  return !found.some(f => f.startsWith('schemas/')) || `JSON Schema 被当成学历: ${found.join(',')}`;
});

// ───────────── B2 版本号：由内容驱动，不由会话次数驱动 ─────────────
t('B2.1', 'v0.1 老状态首次归档只补指纹、不涨版本号', () => {
  const p = J('demo/taskA/task.origin.json');
  const before = readJ(p).version;
  const r = reconcile(p);
  const after = readJ(p);
  return (r.result === 'migrated' && after.version === before && !!after.content_hash)
    || `result=${r.result} version ${before}→${after.version} hash=${!!after.content_hash}`;
});
t('B2.2', '内容一字未改，连跑 3 次 SessionEnd，version 与字节数都不动', () => {
  const p = J('demo/taskA/task.origin.json');
  const v0 = readJ(p).version, bytes0 = fs.statSync(p).size, h0 = readJ(p).content_hash;
  for (let i = 0; i < 3; i++) runHook('.claude/hooks/finalize-state.mjs');
  const s = readJ(p);
  return (s.version === v0 && fs.statSync(p).size === bytes0 && s.content_hash === h0)
    || `version ${v0}→${s.version}，字节 ${bytes0}→${fs.statSync(p).size}`;
});
t('B2.3', '改一个字后跑 SessionEnd：version +1 且 content_hash 变', () => {
  const p = J('demo/taskA/task.origin.json');
  const s = readJ(p); const v0 = s.version, h0 = s.content_hash;
  s.current_state = s.current_state + '（改了一个字）';
  bypassWrite(p, JSON.stringify(s, null, 2));
  runHook('.claude/hooks/finalize-state.mjs');
  const a = readJ(p);
  return (a.version === v0 + 1 && a.content_hash !== h0) || `version ${v0}→${a.version}，hash 变=${a.content_hash !== h0}`;
});
t('B2.4', 'content_hash 不受 version/updated_at/actor 影响（否则版本号自己会把自己顶上去）', () => {
  const base = mkState('x');
  const h1 = contentHash(base);
  const h2 = contentHash({ ...base, version: 999, updated_at: 'zzz', actor: { harness: 'other' } });
  return h1 === h2 || '元字段改变了内容指纹';
});
t('B2.5', '归档只动内容变了的那份，不给没变的任务背锅 +1', () => {
  const pB = J('demo/taskB/task.origin.json'), pC = J('demo/taskC/task.origin.json');
  reconcile(pB); reconcile(pC);
  const vB = readJ(pB).version, vC = readJ(pC).version;
  const s = readJ(pB); s.current_state += '只改 B';
  bypassWrite(pB, JSON.stringify(s, null, 2));
  runHook('.claude/hooks/finalize-state.mjs');
  return (readJ(pB).version === vB + 1 && readJ(pC).version === vC)
    || `B ${vB}→${readJ(pB).version}，C ${vC}→${readJ(pC).version}（C 不该动）`;
});

// ───────────── B3 source 可复核：不再是存在性检查 ─────────────
t('B3.1', '引用了文件/命令/用例编号的 source 判可复核', () =>
  (recheckSource('node southbridge/verify-southbridge.mjs 连跑两轮均 VERIFIED').ok
    && recheckSource('验证用例 T3.2/T3.3').ok
    && recheckSource('wc -l = 2').ok) || '真实 source 被误判为不可复核');
t('B3.2', '纯自然语言断言判 unverifiable', () => {
  const bad = ['我说的，不信拉倒', '实测过了', '确实是这样', ''];
  const wrong = bad.filter(x => recheckSource(x).ok);
  return wrong.length === 0 || `这些胡话被放行了: ${JSON.stringify(wrong)}`;
});
t('B3.3', 'source 描述「文件已被删」时不因路径不存在而误判为假', () =>
  recheckSource('复现：写 demo/_probe_evidence.md → rm → ls 报 No such file').ok
  || '把「文件不存在」这个真事实判成了假');
t('B3.4', 'verify-state：source 全换成胡话后判决翻成 NOT VERIFIED（v0.1 判 VERIFIED）', () => {
  const s = mkState('taskD', { artifacts: [] });
  s.facts = s.facts.map(f => ({ ...f, source: '我说的，不信拉倒' }));
  const p = J('fake-state.json'); writeJ(p, s);
  let code = 0;
  try { execFileSync(process.execPath, [path.join(REPO, 'southbridge/verify-state.mjs'), p], { encoding: 'utf8' }); }
  catch (e) { code = e.status; }
  return code !== 0 || '胡话 source 仍被判 VERIFIED（退出码 0）';
});
t('B3.5', 'verify-state：source 引用可复核物时仍能通过（不误杀历史学历）', () => {
  const p = J('good-state.json'); writeJ(p, mkState('taskE', { artifacts: [] }));
  try { execFileSync(process.execPath, [path.join(REPO, 'southbridge/verify-state.mjs'), p], { encoding: 'utf8' }); return true; }
  catch (e) { return `合法状态被判失败，退出码 ${e.status}`; }
});

// ───────────── B4 并发：学历不再被静默吃掉 ─────────────
t('B4.0', '复现 v0.1 的丢失更新：不走乐观锁直接双写，一条已验证事实被静默吃掉', () => {
  const p = J('demo/race-v01.json');
  writeJ(p, mkState('race', { facts: [{ claim: '原有学历', verified: true, source: 'node x.mjs' }] }));
  const A = readJ(p), B = readJ(p);
  A.facts.push({ claim: 'harness A 学到的', verified: true, source: 'node a.mjs' });
  B.facts.push({ claim: 'harness B 学到的', verified: true, source: 'node b.mjs' });
  fs.writeFileSync(p, JSON.stringify(A, null, 2)); fs.writeFileSync(p, JSON.stringify(B, null, 2));
  const f = readJ(p).facts.map(x => x.claim);
  return !f.includes('harness A 学到的') || 'v0.1 路径居然没丢——那这条缺陷的复现失效了，需重写';
});
t('B4.1', '出示正确 expect → 放行，且 version +1', () => {
  const p = J('demo/lock/task.origin.json');
  writeJ(p, mkState('lock')); reconcile(p);
  const cur = readJ(p);
  const next = { ...cur }; next.facts = [...cur.facts, { claim: 'A 学到的', verified: true, source: 'node a.mjs' }];
  const r = putState(p, next, { expect: cur.content_hash });
  return (r.status === 'done' && readJ(p).facts.length === 2) || `status=${r.status} facts=${readJ(p).facts.length}`;
});
t('B4.2', '出示过期 expect → diverged，且磁盘一个字节没动', () => {
  const p = J('demo/lock/task.origin.json');
  const before = fs.readFileSync(p, 'utf8');
  const stale = readJ(p); const next = { ...stale };
  next.facts = [...stale.facts, { claim: 'B 学到的', verified: true, source: 'node b.mjs' }];
  const r = putState(p, next, { expect: 'deadbeef'.repeat(8) });
  return (r.status === 'diverged' && fs.readFileSync(p, 'utf8') === before)
    || `status=${r.status}，磁盘变了=${fs.readFileSync(p, 'utf8') !== before}`;
});
t('B4.3', '被拒之后先写者的已验证事实仍在（学历没丢）', () =>
  readJ(J('demo/lock/task.origin.json')).facts.some(f => f.claim === 'A 学到的') || 'A 的学历不见了');
t('B4.4', '不带 expect 写已存在的学历 → denied，磁盘未动', () => {
  const p = J('demo/lock/task.origin.json');
  const before = fs.readFileSync(p, 'utf8');
  const r = putState(p, readJ(p), { expect: null });
  return (r.status === 'denied' && fs.readFileSync(p, 'utf8') === before) || `status=${r.status}`;
});
t('B4.5', 'benjing-put CLI 的退出码可被脚本判别：diverged=3 / denied=4', () => {
  const p = J('demo/lock/task.origin.json'), from = J('newstate.json');
  writeJ(from, readJ(p));
  let c1 = 0, c2 = 0;
  try { execFileSync(process.execPath, [path.join(REPO, 'southbridge/benjing-put.mjs'), p, '--expect', 'f'.repeat(64), '--from', from], { encoding: 'utf8' }); } catch (e) { c1 = e.status; }
  try { execFileSync(process.execPath, [path.join(REPO, 'southbridge/benjing-put.mjs'), p, '--from', from], { encoding: 'utf8' }); } catch (e) { c2 = e.status; }
  return (c1 === 3 && c2 === 4) || `diverged 退出码=${c1}（应 3），denied 退出码=${c2}（应 4）`;
});
t('B4.6', '写完回读指纹相符，不信 writeFileSync 没抛错就算写成了', () => {
  const p = J('demo/lock/task.origin.json');
  const cur = readJ(p);
  const r = putState(p, { ...cur, current_state: '回读检查' }, { expect: cur.content_hash });
  return (r.status === 'done' && r.content_hash === contentHash(readJ(p))) || `回读不符：${JSON.stringify(r)}`;
});

// ───────────── B5 provenance：跨模型继承要有举证字段 ─────────────
t('B5.1', '写入后 actor.harness 是观测出来的真值', () => {
  const a = readJ(J('demo/lock/task.origin.json')).actor;
  return (a && a.harness && a.harness !== 'unknown') || `actor=${JSON.stringify(a)}（本机 CLAUDECODE=${process.env.CLAUDECODE}）`;
});
// 本判据原文是「模型名观测不到时写 unobserved」——那锁的是 v0.2 落成时的**限制**，
// 而不是协议的不变量。后来实测模型名能从 transcript / rollout 观测到，限制解除，原判据随即过期。
// 现在锁真正的不变量：model 与 model_source 必须自洽，不许「说不出来源却报得出模型名」。
t('B5.2', 'model 与 model_source 自洽：无来源 ⟺ unobserved，有来源 ⟺ 报得出真值', () => {
  const a = detectActor();
  const noSource = a.model_source === 'none';
  const isUnobserved = a.model === 'unobserved';
  return (noSource === isUnobserved) || `model=${a.model} 却标 source=${a.model_source}`;
});
t('B5.3', '真实仓库里 4 份学历都能被 kind 认出，schema 文件不混进来', () => {
  const found = findStates(REPO).map(f => path.relative(REPO, f).replace(/\\/g, '/'));
  return (!found.includes('schemas/task.origin.json') && found.length >= 3)
    || `findStates 结果异常: ${JSON.stringify(found)}`;
});

// ───────── B6 模型可观测：关掉「换模型继承学历」的举证缺口 ─────────
const FAKE_TRANSCRIPT = J('fake-transcript.jsonl');
fs.writeFileSync(FAKE_TRANSCRIPT, [
  JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', content: [] } }),
  JSON.stringify({ type: 'assistant', message: { model: 'some-other-model-7', content: [] } })
].join('\n'), 'utf8');

t('B6.1', '能从 transcript jsonl 观测出模型名（而不是写 unobserved 了事）', () => {
  const r = observeModel(FAKE_TRANSCRIPT);
  return (r.model === 'some-other-model-7' && r.source === 'transcript') || JSON.stringify(r);
});
t('B6.2', 'model_source 如实标注证据来源，transcript 观测优先于 env 声明', () => {
  const r = observeModel(FAKE_TRANSCRIPT);
  return r.source === 'transcript' || `source=${r.source}（transcript 在场却没被优先采信）`;
});
t('B6.3', '什么都观测不到时写 unobserved/none，不回落去编一个', () => {
  // Windows 绝对路径不能直接喂给 ESM 动态 import，必须转 file:// URL
  const core = pathToFileURL(path.join(REPO, 'southbridge/benjing-core.mjs')).href;
  const code = `import('${core}')` +
    `.then(m=>console.log(JSON.stringify(m.observeModel('/nope/does-not-exist.jsonl'))))`;
  const env = { ...process.env };
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_MODEL', 'ANTHROPIC_MODEL', 'CODEX_MODEL', 'OPENAI_MODEL', 'HOME', 'USERPROFILE']) delete env[k];
  env.HOME = SB; env.USERPROFILE = SB; // 指向空沙箱：既没有 .claude/projects 也没有 .codex/sessions
  const out = execFileSync(process.execPath, ['-e', code], { encoding: 'utf8', env });
  const r = JSON.parse(out.trim());
  return (r.model === 'unobserved' && r.source === 'none') || `观测不到却返回了 ${JSON.stringify(r)}`;
});
t('B6.4', '真实写入留下的 actor 含 harness + model + model_source 三件套', () => {
  const a = readJ(J('demo/lock/task.origin.json')).actor;
  return !!(a && a.harness && a.model && a.model_source) || `actor=${JSON.stringify(a)}`;
});

// ───────── B7 原子写：崩在半路不留半截 JSON ─────────
t('B7.1', '连续写 20 次不留 .tmp- 残留文件', () => {
  const p = J('demo/atomic/task.origin.json');
  writeJ(p, mkState('atomic')); reconcile(p);
  for (let i = 0; i < 20; i++) {
    const cur = readJ(p);
    putState(p, { ...cur, current_state: 'w' + i }, { expect: contentHash(cur) });
  }
  const junk = fs.readdirSync(J('demo/atomic')).filter(f => f.includes('.tmp-'));
  return junk.length === 0 || `残留临时文件: ${JSON.stringify(junk)}`;
});
t('B7.2', '8 个进程并发写同一份学历，读者任何时刻读到的都是完整 JSON（无半截态）', () => {
  const p = J('demo/atomic/task.origin.json');
  const core = pathToFileURL(path.join(REPO, 'southbridge/benjing-core.mjs')).href;
  const code = `import('${core}').then(m=>{for(let i=0;i<60;i++){` +
    `m.writeAtomic(${JSON.stringify(p)}, JSON.stringify({kind:'task.origin',id:'a',i,pad:'x'.repeat(60000)},null,2));}})`;
  for (let k = 0; k < 8; k++) spawn(process.execPath, ['-e', code], { stdio: 'ignore' });

  let reads = 0, broken = 0;
  const until = Date.now() + 2500; // 覆盖住 node 启动 + 8×60 次大写入的窗口
  while (Date.now() < until) {
    try { JSON.parse(fs.readFileSync(p, 'utf8')); reads++; }
    catch { broken++; }
  }
  if (reads < 50) return `读取次数太少(${reads})，测不出并发窗口`;
  return broken === 0 ? true : `${broken}/${reads + broken} 次读到损坏的 JSON`;
});

// ───────── B8 硬拦截：乐观锁不再能被 Write 工具绕过 ─────────
const guardExit = payload => {
  try {
    execFileSync(process.execPath, [path.join(REPO, '.claude/hooks/guard-benjing.mjs')],
      { input: JSON.stringify(payload), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) { return e.status; }
};
t('B8.1', 'Write 直写 task.origin.json → 退出码 2（阻断）', () =>
  guardExit({ tool_name: 'Write', tool_input: { file_path: 'demo/taskZ/task.origin.json' } }) === 2 || '没拦住');
t('B8.2', 'Edit / MultiEdit 同样拦', () =>
  (guardExit({ tool_name: 'Edit', tool_input: { file_path: 'D:/a b/demo/t/task.origin.json' } }) === 2
    && guardExit({ tool_name: 'MultiEdit', tool_input: { file_path: 'demo/t/task.origin.json' } }) === 2) || '有工具漏网');
t('B8.3', '普通文件与只读工具照常放行', () =>
  (guardExit({ tool_name: 'Write', tool_input: { file_path: 'demo/notes.md' } }) === 0
    && guardExit({ tool_name: 'Read', tool_input: { file_path: 'demo/t/task.origin.json' } }) === 0) || '误伤');
t('B8.4', '阻断提示里的路径带引号（本仓库路径含空格，否则照抄即挂）', () => {
  let err = '';
  try { execFileSync(process.execPath, [path.join(REPO, '.claude/hooks/guard-benjing.mjs')], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'D:/a b/task.origin.json' } }), encoding: 'utf8' }); }
  catch (e) { err = e.stderr || ''; }
  return err.includes('"D:/a b/task.origin.json"') || '提示里的路径没加引号';
});
t('B8.5', 'settings.json 真的把 guard 挂在了 PreToolUse 上（脚本再对没接上也白搭）', () => {
  const s = readJ(path.join(REPO, '.claude/settings.json'));
  const pre = s.hooks?.PreToolUse || [];
  const hit = pre.some(g => /Write/.test(g.matcher || '')
    && (g.hooks || []).some(h => (h.args || []).some(a => String(a).includes('guard-benjing.mjs'))));
  return hit || 'PreToolUse 里没找到 guard-benjing.mjs';
});

// ───────── B9 体检：便宜的不变量每次归档都跑 ─────────
t('B9.1', '体检能揪出指纹不符（有人绕过 benjing-put 改过学历）', () => {
  const p = J('demo/taskC/task.origin.json');
  const s = readJ(p); s.current_state = '绕过协议偷改的'; // 故意不更新 content_hash
  bypassWrite(p, JSON.stringify(s, null, 2));
  const h = health(SB);
  const item = h.items.find(i => i.path.includes('taskC'));
  return (item && item.in_sync === false && h.issues >= 1) || `体检没发现: ${JSON.stringify(item)}`;
});
t('B9.2', '体检能揪出不可复核的 source 与缺失的 artifact', () => {
  const p = J('demo/taskH/task.origin.json');
  writeJ(p, mkState('taskH', {
    facts: [{ claim: 'x', verified: true, source: '我说的' }],
    artifacts: ['southbridge/根本不存在.mjs']
  }));
  const item = health(SB).items.find(i => i.path.includes('taskH'));
  return (item.unverifiable_sources.length === 1 && item.missing_artifacts.length === 1)
    || JSON.stringify(item);
});

// ───── B9.3/B9.4 孤儿：体检对「消失的学历」不能是瞎的 ─────
t('B9.3', 'kind 被改坏的 task.origin.json 报为孤儿，而不是从本境静默消失', () => {
  const p = J('demo/orphan1/task.origin.json');
  writeJ(p, { ...mkState('orphan1'), kind: 'TASK.origin' });
  const h = health(SB);
  const o = (h.orphans || []).find(x => x.path.includes('orphan1'));
  return (!!o && h.issues > 0) || `孤儿没被报出来，issues=${h.issues}，orphans=${JSON.stringify(h.orphans)}`;
});
t('B9.4', 'JSON 解析失败的 task.origin.json 同样报孤儿', () => {
  const p = J('demo/orphan2/task.origin.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{ 这不是合法 JSON', 'utf8');
  const o = (health(SB).orphans || []).find(x => x.path.includes('orphan2'));
  return (!!o && /解析失败/.test(o.reason)) || `没报或理由不对: ${JSON.stringify(o)}`;
});

t('B9.5', 'JSON Schema 本身不被报成孤儿（假阳性会把体检训练成噪音）', () => {
  const h = health(SB);
  return !(h.orphans || []).some(o => o.path.includes('schemas/')) || '把 schemas/task.origin.json 报成孤儿了';
});

// ───── B10 文件系统闸门：harness 无关的那道 ─────
const LP = J('demo/lockgate/task.origin.json');
t('B10.1', '归档后学历处于只读状态（闸门自动装上）', () => {
  writeJ(LP, mkState('lockgate')); reconcile(LP);
  return isLockedFS(LP) || '归档后没上只读位';
});
t('B10.2', '上锁后「就地修改」三种写法全部 EPERM，且磁盘一字未改', () => {
  const before = fs.readFileSync(LP, 'utf8');
  const tries = [];
  try { fs.writeFileSync(LP, '{}'); tries.push('writeFileSync 竟然成功'); } catch (e) { if (e.code !== 'EPERM') tries.push('writeFileSync 报了 ' + e.code); }
  try { fs.appendFileSync(LP, 'x'); tries.push('append 竟然成功'); } catch (e) { if (e.code !== 'EPERM') tries.push('append 报了 ' + e.code); }
  const tmp = LP + '.attack';
  try { fs.writeFileSync(tmp, '{}'); fs.renameSync(tmp, LP); tries.push('rename 覆盖竟然成功'); }
  catch (e) { if (e.code !== 'EPERM') tries.push('rename 报了 ' + e.code); try { fs.unlinkSync(tmp); } catch { } }
  if (tries.length) return tries.join('；');
  return fs.readFileSync(LP, 'utf8') === before || '磁盘内容被改了';
});
t('B10.3', '闸门不误伤合法入口：benjing-put 带正确 expect 照样写得进，且写完自动重新上锁', () => {
  const cur = readJ(LP);
  const r = putState(LP, { ...cur, current_state: '合法写入' }, { expect: contentHash(cur) });
  return (r.status === 'done' && readJ(LP).current_state === '合法写入' && isLockedFS(LP))
    || `status=${r.status} locked=${isLockedFS(LP)}`;
});
t('B10.4', '只读位被摘掉时：体检报出来，归档自愈重新装上', () => {
  unlockState(LP);
  const h = health(SB);
  const item = h.items.find(i => i.path.includes('lockgate'));
  if (!item || item.locked !== false) return `体检没发现闸门失效: ${JSON.stringify(item)}`;
  const r = reconcile(LP);
  return (isLockedFS(LP) && r.relocked === true) || `自愈失败: relocked=${r.relocked} locked=${isLockedFS(LP)}`;
});
// 反向判据：记录闸门的真实边界。哪天这条变红，说明环境变了，整套「闸门」的强度要重估。
t('B10.5', '已知边界（反向判据）：「删了重建」能绕过只读位——闸门挡就地修改，不挡删除重建', () => {
  const p = J('demo/lockgate2/task.origin.json');
  writeJ(p, mkState('lockgate2')); reconcile(p);
  if (!isLockedFS(p)) return '前提不成立：文件没上锁';
  try { fs.unlinkSync(p); } catch (e) { return `unlink 只读文件被挡了(${e.code})——边界变了，只读位比预期更强，需重估`; }
  fs.writeFileSync(p, '{"kind":"task.origin","id":"replaced"}', 'utf8');
  return readJ(p).id === 'replaced' || '删除成功但重建失败，边界与记录不符';
});

// ───── B11 写入前校验：乐观锁只证明「你读过」，不证明「你写的还是学历」 ─────
// 2026-08-08 真实数据丢失：另一会话交上来只有 6 个字段的对象（无 kind/id/goal/current_state），
// putState 照单全收 —— demo/task5 的已验证事实 11→3，且因丢了 kind 而整份从本境消失。
// expect 是对的，所以一路绿灯。这批判据把这个洞钉死。
const B11P = J('demo/guard11/task.origin.json');
t('B11.0', '复现事故：只交 6 个字段的残缺对象（反向判据）', () => {
  writeJ(B11P, mkState('guard11', {
    facts: [
      { claim: 'a', verified: true, source: 'node a.mjs' },
      { claim: 'b', verified: true, source: 'node b.mjs' },
      { claim: 'c', verified: true, source: 'node c.mjs' }
    ]
  }));
  reconcile(B11P);
  const cur = readJ(B11P);
  const partial = { version: cur.version, updated_at: cur.updated_at, actor: cur.actor, actions: [], facts: cur.facts, next_steps: cur.next_steps };
  const r = putState(B11P, partial, { expect: contentHash(cur) });
  return (r.status === 'denied' && r.disk_unchanged && readJ(B11P).kind === 'task.origin')
    || `status=${r.status}（应 denied）；盘上 kind=${JSON.stringify(readJ(B11P).kind)}`;
});
t('B11.1', '缺 kind / id / goal / current_state / next_steps 任一 → denied 且磁盘未变', () => {
  const cur = readJ(B11P), h = contentHash(cur);
  for (const k of ['kind', 'id', 'goal', 'current_state', 'next_steps']) {
    const bad = { ...cur }; delete bad[k];
    const before = fs.readFileSync(B11P, 'utf8');
    const r = putState(B11P, bad, { expect: h });
    if (r.status !== 'denied') return `缺 ${k} 时 status=${r.status}`;
    if (fs.readFileSync(B11P, 'utf8') !== before) return `缺 ${k} 时磁盘被改了`;
  }
  return true;
});
t('B11.2', 'kind 不是 task.origin → denied（防止写出一份本境认不出的孤儿）', () => {
  const cur = readJ(B11P);
  const r = putState(B11P, { ...cur, kind: 'TASK.origin' }, { expect: contentHash(cur) });
  return r.status === 'denied' || `status=${r.status}`;
});
t('B11.3', '已验证事实缩水 → denied（默认不许悄悄变少）', () => {
  const cur = readJ(B11P);
  const r = putState(B11P, { ...cur, facts: cur.facts.slice(0, 1) }, { expect: contentHash(cur) });
  // 契约变过一次：护栏从「只拦 facts」推广到 5 个受护集合，返回字段由 facts_before/after
  // 改成 shrunk[]，而这条判据没跟着改，于是它红了一天却像是护栏坏了。
  // 判据断言的是实现的**契约**，契约变了判据必须同步——这跟学历里 artifact 改名不传播是同一件事。
  const f = (r.shrunk || []).find(x => x.k === 'facts');
  return (r.status === 'denied' && r.disk_unchanged && f && f.was === 3 && f.now === 1)
    || `status=${r.status} shrunk=${JSON.stringify(r.shrunk)}`;
});
t('B11.3b', '受护的不只是 facts：decisions/learnings/artifacts 缩水同样被拒', () => {
  const cur = readJ(B11P);
  const seeded = { ...cur, decisions: [{ what: 'd1', why: 'w1' }, { what: 'd2', why: 'w2' }], artifacts: ['a1.md', 'a2.md'] };
  const put1 = putState(B11P, seeded, { expect: contentHash(cur) });
  if (put1.status !== 'done') return `种数据失败: ${put1.status} ${put1.reason || ''}`;
  const now = readJ(B11P);
  const r = putState(B11P, { ...now, decisions: now.decisions.slice(0, 1), artifacts: now.artifacts.slice(0, 1) },
    { expect: contentHash(now) });
  const ks = (r.shrunk || []).map(x => x.k).sort().join(',');
  return (r.status === 'denied' && ks === 'artifacts,decisions')
    || `status=${r.status} 报出的受护集合=${ks || '(无)'}（该是 artifacts,decisions）`;
});
t('B11.4', '显式 __allow_fact_loss 才放行，且该开关不进学历、不进指纹', () => {
  const cur = readJ(B11P);
  const r = putState(B11P, { ...cur, facts: cur.facts.slice(0, 1), __allow_fact_loss: true }, { expect: contentHash(cur) });
  const after = readJ(B11P);
  return (r.status === 'done' && after.facts.length === 1 && after.__allow_fact_loss === undefined
    && after.content_hash === contentHash(after)) || `status=${r.status} 残留开关=${after.__allow_fact_loss}`;
});
t('B11.5', '覆盖前留下真实备份，且备份内容 == 覆盖前的字节', () => {
  const before = fs.readFileSync(B11P, 'utf8');
  const cur = readJ(B11P);
  const r = putState(B11P, { ...cur, current_state: '再改一次' }, { expect: contentHash(cur) });
  if (!r.backup_path) return '没有 backup_path';
  if (!fs.existsSync(r.backup_path)) return `backup_path 指向不存在的文件: ${r.backup_path}`;
  return fs.readFileSync(r.backup_path, 'utf8') === before || '备份内容与覆盖前不一致';
});

// ───────── B12 source 解引用：形式合格 ≠ 引用物还在 ─────────
// 催生用例：另一个会话删掉 bench/run-final*.log，六条 source 当场悬空，
// 而 recheckSource（只查形式）全绿，两次都是人肉撞见的。
// 六条反向用例锁死的是「别造假警报」——首版实测 32 条悬空里 26 条是自己的正则造出来的。
const DSB = SB + '-deref';
fs.mkdirSync(path.join(DSB, 'demo'), { recursive: true });
fs.writeFileSync(path.join(DSB, 'demo', 'here.md'), '在', 'utf8');

t('B12.1', '引用物还在时不报悬空', () => {
  const d = dereferenceSource('见 demo/here.md 第 3 行', DSB);
  return d.missing.length === 0 || `把存在的文件报成了悬空: ${d.missing}`;
});
t('B12.2', '【催生用例】只引路径且路径已不在 → 报悬空', () => {
  const d = dereferenceSource('demo/run-final2.log 结果表 + demo/gone/results.json', DSB);
  return d.missing.length === 2 || `该报 2 条悬空，实报 ${d.missing.length}: ${JSON.stringify(d.missing)}`;
});
t('B12.3', '【反向】悬空不许翻 source 的判决（文件没了 ≠ 事实为假，同 B3.3）', () => {
  const s = '复现：写 demo/_probe.md → rm → ls 报 No such file';
  return (recheckSource(s).ok && dereferenceSource(s, DSB).missing.length >= 0)
    || '解引用把一条合格 source 判成了不合格';
});
t('B12.4', '【反向】基准不可确认时归 unresolved，不许算悬空', () => {
  // 第一段目录既不在 root 也不在兄弟层 —— 那是相对隔壁仓库的路径，我们不知道它相对谁
  const d = dereferenceSource('bench/RESULTS-v2.md 结果表', DSB);
  return (d.missing.length === 0 && d.unresolved.length === 1)
    || `missing=${JSON.stringify(d.missing)} unresolved=${JSON.stringify(d.unresolved)}（该判 unresolved）`;
});
t('B12.5', '【反向】盘符与 ~ 不许被正则切掉（首版靠这个造了 4 条假警报）', () => {
  const d = dereferenceSource('看 C:/Users/x/y.log 与 ~/.uking/providers.json', DSB);
  const bad = d.refs.filter(r => r.startsWith('/Users') || r.startsWith('/.uking'));
  return bad.length === 0 || `被切成了无盘符的绝对路径，会去 D:\\ 根下找: ${JSON.stringify(bad)}`;
});
t('B12.6', '【反向】光秃秃的文件名不查（定位不到唯一位置，查了只造噪音）', () => {
  const d = dereferenceSource('见 results-v2.json 的第二张表', DSB);
  return (d.checked === 0 && d.skipped === 1) || `checked=${d.checked} skipped=${d.skipped}`;
});
t('B12.7', 'health() 必须把悬空亮出来（探针不发声等于没装）', () => {
  writeJ(path.join(DSB, 'demo/taskZ/task.origin.json'), mkState('taskZ', {
    facts: [{ claim: 'Z 的事实', verified: true, source: 'demo/gone/evidence.md 第 3 行' }]
  }));
  const h = health(DSB);
  const it = h.items.find(i => i.path.includes('taskZ'));
  return (it && it.dangling_sources.length === 1 && h.issues >= 1)
    || `dangling=${JSON.stringify(it && it.dangling_sources)} issues=${h && h.issues}`;
});
t('B12.8', '【反向】同一 source 还引了可重跑的命令时不进告警桶（否则 ⚠ 常亮，警报失效）', () => {
  writeJ(path.join(DSB, 'demo/taskY/task.origin.json'), mkState('taskY', {
    facts: [{ claim: 'Y 的事实', verified: true, source: 'node southbridge/x.mjs 写 demo/gone/probe.md → rm → ls 报 No such file' }]
  }));
  const it = health(DSB).items.find(i => i.path.includes('taskY'));
  return (it && it.dangling_sources.length === 0 && it.dangling_with_fallback.length === 1)
    || `告警桶=${JSON.stringify(it && it.dangling_sources)} 兜底桶=${JSON.stringify(it && it.dangling_with_fallback)}`;
});

// ───── B12 护栏泛化 + schema 变成承重件 ─────
// 第一版护栏只拦 facts 缩水 —— 那是修症状不是修那一类。事故的实际损失是
// 11 条 facts + 2 条 decisions + 6 条 learnings + 3 条 artifacts，当时的护栏只看得见一样。
const B12P = J('demo/guard12/task.origin.json');
t('B12.1', '四类集合（decisions/actions/learnings/artifacts）缩水同样被拦，不止 facts', () => {
  writeJ(B12P, mkState('guard12', {
    facts: [{ claim: 'f1', verified: true, source: 'node a.mjs' }],
    decisions: [{ what: 'd1', why: 'r1' }, { what: 'd2', why: 'r2' }],
    actions: [{ verb: 'file.write', target: 'x', status: 'done' }, { verb: 'file.write', target: 'y', status: 'done' }],
    // status 用 candidate：学堂 v0.1 起，schema 规定 verified 必须带 recheck+exam
    // （verified 只能由考试给，作者不能自己写）。这条判据测的是四类集合的缩水拦截，
    // 不是经验的升降级语义，所以夹具跟着 schema 走，不为了让夹具通过去放宽 schema。
    learnings: [{ lesson: 'l1', confidence: 0.8, status: 'candidate' }, { lesson: 'l2', confidence: 0.8, status: 'candidate' }],
    artifacts: ['a.md', 'b.md']
  }));
  reconcile(B12P);
  for (const k of ['decisions', 'actions', 'learnings', 'artifacts']) {
    const cur = readJ(B12P);
    const before = fs.readFileSync(B12P, 'utf8');
    const r = putState(B12P, { ...cur, [k]: cur[k].slice(0, 1) }, { expect: contentHash(cur) });
    if (r.status !== 'denied') return `${k} 缩水时 status=${r.status}（应 denied）`;
    if (!r.shrunk?.some(x => x.k === k)) return `${k} 缩水没被点名: ${JSON.stringify(r.shrunk)}`;
    if (fs.readFileSync(B12P, 'utf8') !== before) return `${k} 缩水时磁盘被改了`;
  }
  return true;
});
t('B12.2', '__allow_loss 显式放行，且开关不落盘、不进指纹', () => {
  const cur = readJ(B12P);
  const r = putState(B12P, { ...cur, learnings: cur.learnings.slice(0, 1), __allow_loss: true }, { expect: contentHash(cur) });
  const after = readJ(B12P);
  return (r.status === 'done' && after.learnings.length === 1
    && after.__allow_loss === undefined && after.content_hash === contentHash(after))
    || `status=${r.status} 残留开关=${after.__allow_loss}`;
});
t('B12.3', 'schema 校验器认得出「缺 kind」——task5 正是缺它而从本境消失，却仍被 verify-state 判绿', () => {
  const bad = { ...readJ(B12P) }; delete bad.kind;
  const problems = checkState(bad);
  return problems.some(p => p.at === 'kind') || `没报缺 kind: ${JSON.stringify(problems)}`;
});
t('B12.4', 'schema 校验器认得出类型漂移（verification 被写成数组）', () => {
  const problems = checkState({ ...readJ(B12P), verification: [] });
  return problems.some(p => p.at === 'verification' && /类型应为 string/.test(p.msg))
    || `没报类型漂移: ${JSON.stringify(problems)}`;
});
t('B12.5', 'schema 用了校验器没实现的关键字 → 报错，不许静默忽略', () => {
  // 静默忽略会让「schema 写了但没生效」重新变成可能，那就绕回「装饰品 schema」的原点。
  const sp = J('fake-schema.json');
  writeJ(sp, { type: 'object', required: ['a'], patternProperties: { '^x': { type: 'string' } } });
  const problems = checkState({ a: 1 }, sp);
  return problems.some(p => /未实现的关键字/.test(p.msg)) || `静默忽略了未实现关键字: ${JSON.stringify(problems)}`;
});
// ── B13 provenance 不许被调用方的标签抹掉（2026-08-09 实测被自己抹过）──
// actor 是「跨模型/跨 harness 继承」这条核心主张的举证材料。v0.2 写的是
// `actor || detectActor()`，于是学堂的考试传了个字符串标签 'xuetang/exam'，
// 一轮就把 8 份学历观测到的 harness/model/model_source 全盖掉了。
t('B13.1', '【反向】调用方传字符串 actor 时，观测到的 provenance 不许被抹掉', () => {
  const p = J('demo/prov1/task.origin.json');
  writeJ(p, mkState('prov1'));
  const cur = readJ(p);
  putState(p, { ...cur, goal: 'changed' }, { expect: contentHash(cur), actor: 'some/label' });
  const a = readJ(p).actor;
  return (a && typeof a === 'object' && typeof a.harness === 'string' && a.by === 'some/label')
    || `actor=${JSON.stringify(a)}`;
});
t('B13.2', '正向：传 object actor 时与观测值合并，不是二选一', () => {
  const p = J('demo/prov2/task.origin.json');
  writeJ(p, mkState('prov2'));
  const cur = readJ(p);
  putState(p, { ...cur, goal: 'changed' }, { expect: contentHash(cur), actor: { by: 'x', extra: 1 } });
  const a = readJ(p).actor;
  return (a.harness && a.by === 'x' && a.extra === 1) || `actor=${JSON.stringify(a)}`;
});
t('B12.6', '合规状态不被误报（校验器不能只会喊狼来了）', () =>
  checkState(readJ(B12P)).length === 0 || `合规状态被报了 ${JSON.stringify(checkState(readJ(B12P)))}`);
t('B12.7', 'health 把 schema 违规计入 issues 并逐条列出（只校验不上报等于没校验）', () => {
  const p = J('demo/schemabad/task.origin.json');
  writeJ(p, mkState('schemabad', { verification: [] }));
  const h = health(SB);
  const item = h.items.find(i => i.path.includes('schemabad'));
  return (item?.schema_issues?.length > 0 && h.issues > 0)
    || `health 没报: ${JSON.stringify(item?.schema_issues)} issues=${h.issues}`;
});


// ─────────────── B13：写入闸门强制 schema 校验（RFC-0010）───────────────
//
// 起因是两次实弹，第二次来自另一个 harness：
//   ① artifacts 写成 [{path,what}]（schema 要 string[]）→ 下游 reobserve / verify-state
//      双双 ERR_INVALID_ARG_TYPE，数据不合规伪装成程序 bug
//   ② codex 写入 source_kind="path+command"（不在允许集内）→ 落盘时无人报错
//
// 三道旧检查之间有条缝：乐观锁只证明「你读过」、必填只查字段在不在、
// 缩水只查条数——都不查**类型**。两次事故都从这条缝穿过去了。
const B13P = J('demo/gate13/task.origin.json');

t('B13.1', '类型违规被拒写（artifacts 用对象形式）且磁盘不动', () => {
  writeJ(B13P, mkState('gate13'));
  const before = fs.readFileSync(B13P, 'utf8');
  const cur = readJ(B13P);
  const bad = { ...cur, artifacts: [{ path: 'a.txt', what: '对象形式' }] };
  const r = putState(B13P, bad, { expect: contentHash(cur) });
  const after = fs.readFileSync(B13P, 'utf8');
  return (r.status === 'denied' && r.disk_unchanged === true && before === after)
    || `status=${r.status} 盘变了=${before !== after}`;
});

t('B13.2', '枚举违规被拒写（source_kind 取允许集之外的值）且磁盘不动', () => {
  const cur = readJ(B13P);
  const bad = { ...cur, facts: [{ claim: 'x', verified: true, source: 'y', source_kind: 'path+command' }] };
  const before = fs.readFileSync(B13P, 'utf8');
  const r = putState(B13P, bad, { expect: contentHash(cur) });
  return (r.status === 'denied' && fs.readFileSync(B13P, 'utf8') === before)
    || `status=${r.status} reason=${r.reason}`;
});

t('B13.3', '拒写结果必须逐条指名违规字段（只拦不报等于没拦）', () => {
  const cur = readJ(B13P);
  const bad = { ...cur, artifacts: [{ path: 'a.txt' }] };
  const r = putState(B13P, bad, { expect: contentHash(cur) });
  return (Array.isArray(r.schema_violations) && r.schema_violations.length > 0
    && JSON.stringify(r.schema_violations).includes('artifacts'))
    || `schema_violations=${JSON.stringify(r.schema_violations)}`;
});

t('B13.4', '【反向】合规学历不得被误拦——闸门不能只会喊狼来了', () => {
  const cur = readJ(B13P);
  const good = { ...cur, current_state: '改一句话，其余全合规' };
  const r = putState(B13P, good, { expect: contentHash(cur) });
  return (r.status === 'done' || r.status === 'unchanged') || `合规写入被拦：${r.status} ${r.reason}`;
});

t('B13.5', '【反向】仓库现有全部学历逐份试写均放行（存量不被锁死）', () => {
  const states = findStates(REPO).filter(f => !f.includes(SB));
  const blocked = [];
  for (const f of states) {
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    const viol = checkState(st);
    if (viol.length) blocked.push(`${f}: ${viol.length} 处`);
  }
  return blocked.length === 0 || `以下存量学历会被新闸门锁死：${blocked.join('; ')}`;
});

// ───────────────────────── 报告 ─────────────────────────
const pass = results.filter(r => r.ok).length;
console.log(`\n═══ 本境 v0.2 一致性验证（benjing/0.2）═══`);
console.log(`沙箱：${SB}\n`);
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.id.padEnd(6)} ${r.desc}`);
  if (!r.ok) console.log(`        └─ ${r.detail}`);
}
console.log(`\n判决：${pass}/${results.length} ${pass === results.length ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
if (pass === results.length) { try { fs.rmSync(SB, { recursive: true, force: true }); fs.rmSync(SB + "-overflow", { recursive: true, force: true }); } catch {} }
else console.log(`（沙箱保留以便排查：${SB}）`);
process.exit(pass === results.length ? 0 : 1);
