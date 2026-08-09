#!/usr/bin/env node
// 从正典文本抽取「华生提及但从未展开的案件」，逐条给出出处篇名、行号与原文引语。
//
// 为什么要有这个脚本而不是手写清单：手写清单是「我记得正典里有这么一句」，
// 那是记忆不是证据。本项目的每个实验实例都必须能指回盘上某一行。
// 同样重要的是——**探针没命中的必须如实列出**。只报命中项的抽取器，
// 其失败模式与成功无法区分。
//
// 用法：
//   node demo/holmes-untold/extract-instances.mjs            # 人类可读报告
//   node demo/holmes-untold/extract-instances.mjs --json     # 机器可读实例清单
// 退出码：0 = 命中数 ≥ 12（够做多实例实验）  2 = 不足 12  1 = 语料缺失

import fs from 'node:fs';
import path from 'node:path';
import { observeText, locate } from '../../benxiang/observe-text.mjs';

const CORPUS_DIR = 'demo/holmes-untold/corpus';
// 完整正典：四部长篇 + 五部短篇集
const VOLUMES = {
  'pg244.txt': 'A Study in Scarlet',
  'pg2097.txt': 'The Sign of the Four',
  'pg1661.txt': 'The Adventures of Sherlock Holmes',
  'pg834.txt': 'The Memoirs of Sherlock Holmes',
  'pg2852.txt': 'The Hound of the Baskervilles',
  'pg108.txt': 'The Return of Sherlock Holmes',
  'pg3289.txt': 'The Valley of Fear',
  'pg2350.txt': 'His Last Bow',
  'pg69700.txt': 'The Case-Book of Sherlock Holmes'
};

// 每条探针锚定一个足够独特的字符串。宁可窄，不可宽——
// 宽探针会把正文里的普通用词也算成「未叙案件」，那是往有利方向注水。
const CANDIDATES = [
  { id: 'UC01', name: '苏门答腊巨鼠 / 船 Matilda Briggs',        probe: /rat of Sumatra/i },
  { id: 'UC02', name: '坎伯韦尔投毒案',                          probe: /Camberwell poisoning/i },
  { id: 'UC03', name: '酒商 Vamberry',                           probe: /Vamberry/i },
  { id: 'UC04', name: 'Tarleton 谋杀案',                         probe: /Tarleton/i },
  { id: 'UC05', name: '铝制拐杖',                                probe: /aluminium crutch/i },
  { id: 'UC06', name: '跛足 Ricoletti 与其妻',                   probe: /Ricoletti/i },
  { id: 'UC07', name: 'Darlington 掉包丑闻',                     probe: /Darlington substitution/i },
  { id: 'UC08', name: 'Arnsworth 城堡事件',                      probe: /Arnsworth/i },
  { id: 'UC09', name: '两位科普特族长',                          probe: /Coptic Patriarch/i },
  { id: 'UC10', name: 'Abernetty 家族 / 黄油里的欧芹',           probe: /Abernetty/i },
  { id: 'UC11', name: 'Isadora Persano 与异虫',                  probe: /Persano/i },
  { id: 'UC12', name: '业余乞丐会',                              probe: /Amateur Mendicant/i },
  { id: 'UC13', name: '三桅船 Sophy Anderson 失踪',              probe: /Sophy Anderson/i },
  { id: 'UC14', name: 'Grice Paterson 兄弟于 Uffa 岛',           probe: /Grice Paterson/i },
  { id: 'UC15', name: '政客、灯塔与受训鸬鹚',                    probe: /trained cormorant/i },
  { id: 'UC16', name: 'James Phillimore 回屋取伞',               probe: /Phillimore/i },
  // UC17 第一版探针写作 /cutter Alicia|Alicia/，命中的是《贵族单身汉》里的
  // Lady Alicia Whittington——一个跟未叙案件毫无关系的人名。宽探针往有利方向注水，
  // 这条假阳性是本抽取器自己犯的第一个错，留注释存证。
  { id: 'UC17', name: '快艇 Alicia',                             probe: /cutter Alicia/i },
  { id: 'UC18', name: 'Warburton 上校之疯',                      probe: /Warburton/i },
  { id: 'UC19', name: 'Farintosh 夫人的猫眼石头饰',              probe: /Farintosh/i },
  { id: 'UC20', name: 'Vatican 浮雕宝石',                        probe: /Vatican cameo/i },
  { id: 'UC21', name: 'Conk-Singleton 伪造案',                   probe: /Conk-Singleton/i },
  { id: 'UC22', name: 'Maupertuis 男爵 / 荷属苏门答腊公司',      probe: /Maupertuis/i },
  { id: 'UC23', name: '红水蛭的可憎故事',                        probe: /red leech/i },
  { id: 'UC24', name: '银行家 Crosby 之死',                      probe: /Crosby,? the banker/i },
  { id: 'UC25', name: 'Addleton 惨案 / 古不列颠墓冢',            probe: /Addleton/i },
  { id: 'UC26', name: 'Smith-Mortimer 继承案',                   probe: /Smith-Mortimer/i },
  { id: 'UC27', name: '林荫道刺客 Huret',                        probe: /Huret/i },
  { id: 'UC28', name: '金丝雀训练师 Wilson',                     probe: /canary-trainer/i },
  { id: 'UC29', name: 'Tosca 红衣主教猝死',                      probe: /Cardinal Tosca/i },
  { id: 'UC30', name: 'Dundas 分居案',                           probe: /Dundas separation/i },
  { id: 'UC31', name: '俄国老妇人',                              probe: /old Russian woman/i },
  { id: 'UC32', name: 'Bishopgate 珠宝案',                       probe: /Bishopsgate|Bishopgate/i }
];

// 规范化与跨行搜索的职责已收进本象（benxiang/observe-text.mjs）。
// 原因见该文件顶部：这个病在同一个会话里被独立犯了两次。
// 篇名判定：向上找最近的篇题行。两种形状都要认——
// Case-Book / Return 用全大写 "THE ADVENTURE OF THE VEILED LODGER"，
// Memoirs / Adventures 用 "VI. The Musgrave Ritual"，
// 只认全大写会让后者整卷报「未定位篇名」。
function findStoryTitle(lines, at) {
  for (let i = at; i >= 0 && i > at - 6000; i--) {
    const l = (lines[i] || '').trim();
    if (l.length < 6 || l.length > 80) continue;
    const letters = l.replace(/[^A-Za-z]/g, '');
    if (letters.length < 5) continue;
    const allCaps = letters === letters.toUpperCase() && /^[IVXLC0-9. ]*[A-Z]/.test(l);
    const numberedTitle = /^(?:ADVENTURE\s+)?[IVXLC]+\.\s+\S/.test(l);
    // 四部长篇用 "Chapter I" 单独成行、篇题在下一非空行，跟短篇集完全不同。
    const chapterHead = /^(?:Chapter|CHAPTER)\s+[IVXLC0-9]+\.?$/.test(l);
    if (chapterHead) {
      for (let j = i + 1; j < i + 5 && j < lines.length; j++) {
        const nx = (lines[j] || '').trim();
        if (nx && nx.length <= 80) return `${l} — ${nx}`;
      }
      return l;
    }
    if (allCaps || numberedTitle) return l;
  }
  return '(未定位篇名)';
}

if (!fs.existsSync(CORPUS_DIR)) {
  console.error(`缺语料目录 ${CORPUS_DIR}，先跑 node demo/fetch-corpus.mjs holmes-untold`);
  process.exit(1);
}

const loaded = [];
for (const [file, vol] of Object.entries(VOLUMES)) {
  const p = path.join(CORPUS_DIR, file);
  if (!fs.existsSync(p)) { console.error(`缺 ${p}`); process.exit(1); }
  const text = fs.readFileSync(p, 'utf8');
  loaded.push({ file, vol, lines: text.split(/\r?\n/), obs: observeText(text) });
}

const found = [], missing = [];
for (const c of CANDIDATES) {
  const hits = [];
  for (const { file, vol, lines, obs } of loaded) {
    for (const m of locate(obs, c.probe, { context: 70 })) {
      hits.push({ volume: vol, file, line: m.line, story: findStoryTitle(lines, m.line - 1), quote: m.quote });
    }
  }
  if (hits.length) found.push({ ...c, probe: String(c.probe), hits });
  else missing.push(c);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ found, missing: missing.map(m => ({ id: m.id, name: m.name, probe: String(m.probe) })) }, null, 2));
} else {
  console.log(`\n═══ 命中 ${found.length} / ${CANDIDATES.length} 条候选\n`);
  for (const f of found) {
    const h = f.hits[0];
    console.log(`${f.id}  ${f.name}`);
    console.log(`      ${h.file}:${h.line}  《${h.story}》${f.hits.length > 1 ? `  (共 ${f.hits.length} 处)` : ''}`);
    console.log(`      “${h.quote}”\n`);
  }
  console.log(`─── 未命中 ${missing.length} 条（不在已下载的五卷内，或探针写错，或本就不存在）`);
  for (const m of missing) console.log(`     ${m.id}  ${m.name}  ${m.probe}`);
}

// --json 时汇总走 stderr：stdout 必须是干净的 JSON，否则下游 JSON.parse 会炸。
const summary = `\n可用实例数 ${found.length}，多实例实验需要 ≥12`;
(process.argv.includes('--json') ? console.error : console.log)(summary);
process.exit(found.length >= 12 ? 0 : 2);
