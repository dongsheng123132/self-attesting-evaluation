#!/usr/bin/env node
// 构造隐藏判据集 H。
//
// 设计上的一个选择，写在这里免得日后被误解为「藏东西」：
// H 不是秘密文件，是**可复现的派生物**。本脚本提交进仓库，H 本身 gitignore，
// 只提交 SEAL.json（H 的 sha256）。任何人都能重跑本脚本重建 H 并核对哈希，
// 从而确认 H 在第一次生成之前就已经固定。
// 「隐藏」的含义是**生成阶段的上下文里没有它**，不是「公众看不到」。
// 藏一个谁也验不了的秘密文件，可信度反而更低。
//
// 硬规矩（与 extract-instances.mjs 同）：每条正典事实类判据必须能指回语料某一行。
// 探针验不中就不进集合，并如实报告被剔除了哪些——只报进了集合的那些，
// 其失败模式与成功无法区分。
//
// 确定性：输出不含任何时间戳/随机量，否则哈希每次都变，封存就失去意义。
//
// 用法：
//   node demo/holmes-untold/build-hidden.mjs            # 构建并写入 hidden/constraints-hidden.json
//   node demo/holmes-untold/build-hidden.mjs --stdout   # 只打印，不写盘
// 退出码：0 = 成功  2 = 有判据未能锚定到语料  1 = 语料缺失

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { observeText, locate } from '../../benxiang/observe-text.mjs';

const CORPUS = 'demo/holmes-untold/corpus';
const OUT_DIR = 'demo/holmes-untold/hidden';
const OUT = path.join(OUT_DIR, 'constraints-hidden.json');

// ── H1：正典事实。每条给一个探针，必须在语料里锚定得到，否则剔除。
// 刻意包含一条正典自相矛盾的事实（H1.06 华生的伤处），因为判据不能惩罚
// 连柯南·道尔自己都没统一的东西——那会把「比原作者还严」当成严谨。
const CANON_FACTS = [
  { id: 'H1.01', fact: '福尔摩斯与华生的住址是贝克街 221B',                probe: /221B Baker Street/i,        violation: '写成其他门牌或其他街道' },
  { id: 'H1.02', fact: '哈德森太太是房东，不是女仆、厨娘或亲属',            probe: /Mrs\. Hudson/i,             violation: '把她写成佣人、亲戚或福尔摩斯的雇员' },
  { id: 'H1.03', fact: '迈克罗夫特是福尔摩斯的兄长，出入第欧根尼俱乐部',    probe: /Diogenes Club/i,            violation: '写成弟弟、或让他在俱乐部内高声交谈' },
  { id: 'H1.04', fact: '莫里亚蒂是教授，犯罪组织的首脑',                    probe: /Professor Moriarty/i,       violation: '写成警察、或与福尔摩斯为友' },
  { id: 'H1.05', fact: '莱辛巴赫瀑布是福尔摩斯与莫里亚蒂的对决地',          probe: /Reichenbach/i,              violation: '把对决地写成别处' },
  { id: 'H1.06', fact: '华生受过阿富汗的杰泽尔枪伤（正典自身在肩/腿之间不一致）', probe: /Jezail bullet/i,        violation: '否认其战场负伤经历；但写肩或写腿都不算违反——正典本身不统一' },
  { id: 'H1.07', fact: '玛丽·摩斯坦是华生之妻',                            probe: /Mary Morstan/i,             violation: '写成他人之妻或与华生无关' },
  { id: 'H1.08', fact: '福尔摩斯使用百分之七溶液（可卡因）',                probe: /seven-per-cent/i,           violation: '写成酗酒或其他成瘾物' },
  { id: 'H1.09', fact: '福尔摩斯懂巴利茨（baritsu）格斗术',                 probe: /baritsu/i,                  violation: '写成其他具名武术' },
  { id: 'H1.10', fact: '雷斯垂德是苏格兰场探长',                            probe: /Lestrade/i,                 violation: '写成私家侦探或福尔摩斯的助手' },
  { id: 'H1.11', fact: '福尔摩斯退隐后在苏塞克斯养蜂',                      probe: /bee-farming|queen bees|bees/i, violation: '写成退隐后继续在伦敦开业' },
  { id: 'H1.12', fact: '华生是军医出身的医生',                              probe: /Army Medical Department|surgeon/i, violation: '写成律师、记者或警官' }
];

// ── H4：编年。同样要锚定。
const CHRONOLOGY = [
  { id: 'H4.01', fact: '莱辛巴赫之后福尔摩斯被认为已死，直到多年后重现（大空白期）', probe: /Reichenbach/i, violation: '让福尔摩斯在空白期内公开在伦敦办案' },
  { id: 'H4.02', fact: '华生婚后一度迁出贝克街自行开业',                     probe: /Mary Morstan/i, violation: '让已婚的华生同时长住贝克街且无任何交代' }
];

// ── H2：跨实例一致性。这是主要终点，也是唯一直接检验「持久状态」的一组。
// 它不锚定语料——它检验的是模型自己在多个实例之间是否自洽。
const CROSS_INSTANCE = [
  { id: 'H2.01', rule: '同一模型在不同实例中为同一正典人物赋予的属性（年龄、亲属、职业、居所）不得互相矛盾' },
  { id: 'H2.02', rule: '某实例中新造的专有名词（人名/地名/机构），若在另一实例中再次出现，其身份与属性必须一致' },
  { id: 'H2.03', rule: '各实例自报的案件年份合并后不得产生不可能的时间线（同一时段华生同时在两地）' },
  { id: 'H2.04', rule: '某实例中声明为「已死」「已入狱」「已移居国外」的人物，不得在时间上更晚的实例中无解释地重新登场' },
  { id: 'H2.05', rule: '叙述框架自洽：若某实例声称本案「从未发表」，不得在另一实例中被当作已发表案件引用' }
];

// ─────────────────────────────────────────────────────────────
if (!fs.existsSync(CORPUS)) { console.error(`缺语料 ${CORPUS}`); process.exit(1); }

const files = fs.readdirSync(CORPUS).filter(f => f.endsWith('.txt')).sort();
const observed = files.map(f => ({
  file: f,
  obs: observeText(fs.readFileSync(path.join(CORPUS, f), 'utf8'))
}));

function anchor(probe) {
  for (const { file, obs } of observed) {
    const h = locate(obs, probe, { context: 0 });
    if (h.length) return { file: `${CORPUS}/${file}`, line: h[0].line, hits: h.length };
  }
  return null;
}

const grounded = [], dropped = [];
for (const c of [...CANON_FACTS, ...CHRONOLOGY]) {
  const a = anchor(c.probe);
  if (a) grounded.push({ id: c.id, fact: c.fact, violation: c.violation, anchor: a, probe: String(c.probe) });
  else dropped.push({ id: c.id, fact: c.fact, probe: String(c.probe) });
}

// ── H3：逐实例的种子细节。由 extract-instances 的输出派生，不手写。
const inst = JSON.parse(execFileSync('node', ['demo/holmes-untold/extract-instances.mjs', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const seedItems = inst.found.map(f => ({
  id: `H3.${f.id}`,
  instance: f.id,
  name: f.name,
  anchor: { file: `${CORPUS}/${f.hits[0].file}`, line: f.hits[0].line, story: f.hits[0].story },
  rule: '种子引语中的专有名词必须保持其语境所蕴含的语义类型（船名仍是船、人名仍是人、地名仍是地），且案件的基本性质不得与种子句相悖',
  seed_quote: f.hits[0].quote
}));

const hidden = {
  spec: 'holmes-untold/constraints-v1',
  set: 'hidden',
  note: '隐藏判据 H：生成阶段不可见，仅用于事后评分。主要终点为 H2（跨实例一致性）。',
  primary_endpoint: 'H2',
  built_from: Object.fromEntries(files.map(f => [
    f, crypto.createHash('sha256').update(fs.readFileSync(path.join(CORPUS, f))).digest('hex')
  ])),
  H1_H4_canon: grounded,
  H2_cross_instance: CROSS_INSTANCE,
  H3_seed_fidelity: seedItems,
  dropped_unanchored: dropped
};

const json = JSON.stringify(hidden, null, 2);
const sha = crypto.createHash('sha256').update(json).digest('hex');

if (process.argv.includes('--stdout')) {
  console.log(json);
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, json);
  console.log(`写入 ${OUT}`);
}
console.error(`锚定成功 ${grounded.length} 条，剔除 ${dropped.length} 条${dropped.length ? '：' + dropped.map(d => d.id).join(',') : ''}`);
console.error(`H3 逐实例 ${seedItems.length} 条，H2 跨实例 ${CROSS_INSTANCE.length} 条`);
console.error(`sha256(H) = ${sha}`);
process.exit(dropped.length ? 2 : 0);
