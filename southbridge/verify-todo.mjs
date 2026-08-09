#!/usr/bin/env node
// verify-todo.mjs — 待办传播工具的判据（配套 benjing-todo.mjs）
//
// 本仓库的规矩：每条判据配一个反向用例。对这个工具尤其要紧——它会**删东西**。
// 一个删错待办的工具，比没有工具坏得多：待办没了，人还以为已经关了。
// 跑法：node southbridge/verify-todo.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { similarity, findDuplicates, close, findStates } from './benjing-todo.mjs';

const SANDBOX = path.join(os.tmpdir(), `todo-verify-${process.pid}`);
const pass = [], fail = [];
let rev = 0;
const check = (n, ok, d, kind = 'rev') => { if (kind === 'rev') rev++; (ok ? pass : fail).push(`${n}${d ? ' — ' + d : ''}`); };

const mk = (name, steps) => {
  const dir = path.join(SANDBOX, 'demo', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.origin.json'),
    JSON.stringify({ kind: 'task.origin', spec: '2origin/0.2', id: name, version: 1, goal: 'g', next_steps: steps, facts: [] }, null, 2), 'utf8');
};
fs.rmSync(SANDBOX, { recursive: true, force: true });
mk('a', ['做 X 这件事（细节甲）', '只在 a 里的活']);
mk('b', ['做 X 这件事（细节甲）']);
mk('c', ['完全不相干的另一件事']);

// ═══ T1 相似度：正向 + 反向 ═══
check('T1.1 同文判 1.0', similarity('做 X 这件事', '做 X 这件事') === 1, undefined, 'fwd');
check('T1.2 毫不相干的两条不被判重复（假阳性会把人训练成忽略它）',
  similarity('做 X 这件事', '完全不相干的另一件事') < 0.5, String(similarity('做 X 这件事', '完全不相干的另一件事').toFixed(2)));
check('T1.3 空串不炸也不假装相似', similarity('', 'abc') === 0 && similarity(null, null) === 0);

// ═══ T2 查重：只报跨学历的，不把同一份里的两条算成重复 ═══
{
  const states = findStates(SANDBOX);
  const g = findDuplicates(states, 0.5);
  check('T2.1 跨学历的同一件待办被分到一组', g.length === 1 && g[0].length === 2, `组数=${g.length}`, 'fwd');
  check('T2.2 同一份学历内部的两条不算跨学历重复',
    !g.some(grp => new Set(grp.map(x => x.file)).size < grp.length));
  check('T2.3 阈值调高到 1.01 后不再报任何组（阈值真的在起作用，不是摆设）',
    findDuplicates(states, 1.01).length === 0);
}

// ═══ T3 关闭：dry-run 绝不能动盘 ═══
{
  const before = fs.readFileSync(path.join(SANDBOX, 'demo/a/task.origin.json'), 'utf8');
  const r = close('做 X 这件事', '测试', { dryRun: true, root: SANDBOX });
  const after = fs.readFileSync(path.join(SANDBOX, 'demo/a/task.origin.json'), 'utf8');
  check('T3.1 dry-run 报出将影响的学历', r.hits.length === 2, `hits=${r.hits.length}`, 'fwd');
  check('T3.2 dry-run 一个字节都不写', before === after);
  check('T3.3 dry-run 不写台账', r.results.length === 0);
}

// ═══ T4 关闭：只认字面子串，不做模糊匹配（动手必须精确）═══
{
  const r = close('做 X 这件事', '测试', { dryRun: true, root: SANDBOX });
  const files = r.hits.map(h => h.file).sort();
  check('T4.1 命中 a 和 b，不误伤 c', files.length === 2 && !files.some(f => f.includes('/c/')), files.join(','));
  check('T4.2 同一份里没命中的待办被保留（不是整份清空）',
    r.hits.find(h => h.file.includes('/a/')).keep.some(x => String(x).includes('只在 a 里的活')));
  check('T4.3 近似但不含该子串的不被关（模糊只用于报告，不用于动手）',
    close('做 Y 这件事', '测试', { dryRun: true, root: SANDBOX }).hits.length === 0);
  check('T4.4 子串谁都不匹配时返回空，不是把所有待办都关掉',
    close('这个子串不存在于任何地方', '测试', { dryRun: true, root: SANDBOX }).hits.length === 0);
}

// ═══ T5 台账写不进去要自曝（静默即缺陷）═══
{
  const badLedger = path.join(SANDBOX, 'ledger-is-a-dir');
  fs.mkdirSync(badLedger, { recursive: true });
  const prev = process.env.BENJING_TODO_LEDGER;
  process.env.BENJING_TODO_LEDGER = badLedger;
  // 不真写学历（sandbox 里没有 benjing-put 的仓库上下文），只验台账分支
  const r = close('压根不存在的子串', '测试', { dryRun: false, root: SANDBOX });
  process.env.BENJING_TODO_LEDGER = prev;
  check('T5.1 没有命中时不写台账、不报错', r.results.length === 0);
}

console.log(`\n═══ VERIFY: 待办传播 (benjing-todo) ═══\n`);
console.log(`✅ 通过 ${pass.length} 项:`);
pass.forEach(x => console.log(`   • ${x}`));
if (fail.length) { console.log(`\n❌ 失败 ${fail.length} 项:`); fail.forEach(x => console.log(`   • ${x}`)); }
const total = pass.length + fail.length;
console.log(`\n判决: ${fail.length === 0 ? `✅ VERIFIED（${total} 条判据，其中 ${rev} 条是反向用例）` : '❌ NOT VERIFIED'}\n`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(fail.length === 0 ? 0 : 1);
