#!/usr/bin/env node
// 引文回查 v0.1 —— research/citations.json 里每个 arXiv id 是否真的指向记录的那篇论文。
//
// 为什么存在：一份没有引用的综述，和一份编造的综述，长得一模一样。
// 本仓库的规矩是 fact 的 source 必须引可复核物；这个脚本就是那个「复核」动作本身。
//
//   node research/verify-citations.mjs              逐条回查
//   node research/verify-citations.mjs --self-test  反向用例：喂假条目，断言它必须变红
//
// 退出码 0=全部对上  1=有对不上的（红）  3=网络/arXiv 不可达（环境坏了 ≠ 引文错了，不判红）

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://export.arxiv.org/api/query';

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** 从 citations.json 摊平出 [{ id, title, group }] */
function loadLedger(path = join(HERE, 'citations.json')) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const out = [];
  for (const [group, entries] of Object.entries(raw)) {
    if (group.startsWith('_') || typeof entries !== 'object') continue;
    for (const [id, title] of Object.entries(entries)) {
      if (id.startsWith('_')) continue;
      out.push({ id, title, group });
    }
  }
  return out;
}

/** 向 arXiv 问一批 id，返回 Map<id, 真实标题>。网络不可达 → 抛错。 */
async function fetchTitles(ids) {
  const res = await fetch(`${API}?id_list=${ids.join(',')}&max_results=${ids.length}`);
  if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
  const xml = await res.text();
  const found = new Map();
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (e.match(/<id>\s*http[s]?:\/\/arxiv\.org\/abs\/([^v<\s]+)/) || [])[1];
    const title = ((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/\s+/g, ' ').trim();
    if (id) found.set(id, title);
  }
  return found;
}

/** 判决一批条目。返回 { rows, red } —— 纯函数，自测复用它。 */
function judge(ledger, found) {
  const rows = ledger.map((c) => {
    const actual = found.get(c.id);
    const ok = actual !== undefined && norm(actual) === norm(c.title);
    return { ...c, actual, ok };
  });
  return { rows, red: rows.filter((r) => !r.ok) };
}

async function main() {
  const selfTest = process.argv.includes('--self-test');
  const ledger = loadLedger();

  let found;
  try {
    found = await fetchTitles(ledger.map((c) => c.id));
  } catch (err) {
    console.error(`⚠ 跑不起来（不判红）：${err.message}`);
    console.error('  引文没有被证伪，只是这次没能核。环境好了再跑。');
    process.exit(3);
  }

  const { rows, red } = judge(ledger, found);
  for (const r of rows) {
    if (r.ok) console.log(`✔ arXiv:${r.id}  ${r.title}`);
    else if (r.actual === undefined) console.log(`✘ arXiv:${r.id}  该 id 在 arXiv 上取不到条目`);
    else console.log(`✘ arXiv:${r.id}  台账写「${r.title}」，arXiv 实为「${r.actual}」`);
  }
  console.log(`\n判决：${rows.length - red.length}/${rows.length}`);

  if (selfTest) {
    // 反向用例：恒绿考题只能用「造一个真的会错的考生」来证伪（RFC-0009 §0）
    const bogus = [
      { id: '2601.99999', title: 'A Paper That Does Not Exist', group: '_selftest' },
      { id: ledger[0].id, title: 'Deliberately Wrong Title For A Real Paper', group: '_selftest' },
    ];
    const caught = judge(bogus, found).red.length;
    console.log(`\n[self-test] 喂 2 条假条目 → 抓到 ${caught}/2`);
    if (caught !== 2) {
      console.log('✘ 本校验器抓不住假条目 —— 它是恒绿考题，别信它的绿。');
      process.exit(1);
    }
    console.log('✔ 假条目会变红，本校验器不是恒绿的');
  }

  process.exit(red.length ? 1 : 0);
}

main();
