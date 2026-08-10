#!/usr/bin/env node
// 取语料并验指纹。语料不进 git（体积大、且与仓库「学历记指纹不记 blob」的路子冲突），
// 靠这个脚本 + 学历里记的 sha256 保证可重建。
//
// 用法：
//   node demo/fetch-corpus.mjs            # 取全部缺失的，已存在的只验指纹
//   node demo/fetch-corpus.mjs ulysses-19 # 只取某一轨
//   node demo/fetch-corpus.mjs --verify   # 一个都不下，只验已有的
// 退出码：0 = 全部就位且指纹相符   2 = 有缺失或指纹不符   1 = 用法/网络错误

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const MANIFEST = [
  {
    track: 'ulysses-19',
    file: 'demo/ulysses-19/corpus/pg4300-ulysses-1922.txt',
    url: 'https://www.gutenberg.org/cache/epub/4300/pg4300.txt',
    sha256: 'e03094626f9528cf3fc287a49d6edbdbf47cd40483cb13ceb301e74e15ebbf9e',
    note: '对照排印本。注意：已被 collate.mjs 判为 POST-1922-EDITED，不是底本权威'
  },
  {
    track: 'ulysses-19',
    file: 'demo/ulysses-19/corpus/archive-1922-shakespeare-ocr.txt',
    url: 'https://archive.org/download/ulyssesshake1922_1hmp/ulyssesshake1922_1hmp_djvu.txt',
    sha256: 'cef7b5441e1e60ed46de2db9fda0eeabe30cd137701909e64b1c3a172c35334c',
    // 指纹不符不等于取错文件：archive.org 重跑 OCR 会改变派生文本。
    // 此时应重跑 collate.mjs 确认判决仍为 CONSISTENT-WITH-1922，再更新本指纹。
    note: '底本权威：1922 Shakespeare & Company 初版扫描件 OCR。OCR 质量粗糙，读法为准、排印不为准'
  },
  {
    track: 'spenser-7-1',
    file: 'demo/spenser-7-1/corpus/pg70717.txt',
    url: 'https://www.gutenberg.org/cache/epub/70717/pg70717.txt',
    sha256: '50c39558176779d02f3e9b3498f235e353489f5f51e7cd41527c6eb9ff819d4e',
    note: '《仙后》卷一：Books I–III'
  },
  {
    track: 'spenser-7-1',
    file: 'demo/spenser-7-1/corpus/pg72698.txt',
    url: 'https://www.gutenberg.org/cache/epub/72698/pg72698.txt',
    sha256: 'f10bc49ebd8441466a0940a0eda83a572ae90a120b1c5282e44308e00d32c5d9',
    note: '《仙后》卷二：Books IV–VII，含《变易篇》两章与 vnperfite 第八章'
  },
  {
    track: 'holmes-untold',
    file: 'demo/holmes-untold/corpus/pg244.txt',
    url: 'https://www.gutenberg.org/cache/epub/244/pg244.txt',
    sha256: 'b1ce37ab30c24d470681c3c2bc746be7555d2a9b63d64eb7f477fe73e09d1a8f',
    note: '正典：A Study in Scarlet'
  },
  {
    track: 'holmes-untold',
    file: 'demo/holmes-untold/corpus/pg2097.txt',
    url: 'https://www.gutenberg.org/cache/epub/2097/pg2097.txt',
    sha256: '4cdea89cf6cd2567a556d0e6901edb89949dd79e200dbaf4ced4cabf1d5d2c26',
    note: '正典：The Sign of the Four'
  },
  {
    track: 'holmes-untold',
    file: 'demo/holmes-untold/corpus/pg1661.txt',
    url: 'https://www.gutenberg.org/cache/epub/1661/pg1661.txt',
    sha256: '922e2a12ccb43a4c9544c260b2166c6ad2097aeb5957faeee113f173bb857cd0',
    note: '正典：The Adventures of Sherlock Holmes'
  },
  {
    track: 'holmes-untold',
    file: 'demo/holmes-untold/corpus/pg834.txt',
    url: 'https://www.gutenberg.org/cache/epub/834/pg834.txt',
    sha256: '509da3f8bbdc6c3857073e74911f628eef8fea557fcb5bca9e1713c846e43ec3',
    note: '正典：The Memoirs of Sherlock Holmes'
  },
  {
    track: 'holmes-untold',
    file: 'demo/holmes-untold/corpus/pg2852.txt',
    url: 'https://www.gutenberg.org/cache/epub/2852/pg2852.txt',
    sha256: 'f7c8c68729d32a5f6a04a5a9ad73d184176e66a6c76b3992c41c1ab47b427d98',
    note: '正典：The Hound of the Baskervilles'
  },
  {
    track: 'holmes-untold',
    file: 'demo/holmes-untold/corpus/pg108.txt',
    url: 'https://www.gutenberg.org/cache/epub/108/pg108.txt',
    sha256: '8c4de14b3a1952417eca4673fcb1b8aa8f946f8a4164f10ec761368af34d5e5a',
    note: '正典：The Return of Sherlock Holmes'
  },
  {
    track: 'holmes-untold',
    file: 'demo/holmes-untold/corpus/pg3289.txt',
    url: 'https://www.gutenberg.org/cache/epub/3289/pg3289.txt',
    sha256: '380bfdbf3ab3b2a9e1e059a17de187929f3ac91629225daa093d01b6cb348d48',
    note: '正典：The Valley of Fear'
  },
  {
    track: 'holmes-untold',
    file: 'demo/holmes-untold/corpus/pg2350.txt',
    url: 'https://www.gutenberg.org/cache/epub/2350/pg2350.txt',
    sha256: 'b1afb9459790ed4601453097d5c9bcece0b84f0dbe93a9a34510a9acb844f53f',
    note: '正典：His Last Bow'
  },
  {
    track: 'holmes-untold',
    file: 'demo/holmes-untold/corpus/pg69700.txt',
    url: 'https://www.gutenberg.org/cache/epub/69700/pg69700.txt',
    sha256: '91f86e29b576c27576d199a8889a85bdb297e214d18e71e12b5efe3c69c425cd',
    note: '正典：The Case-Book of Sherlock Holmes'
  },
  // ── C 轨（红楼梦）：只有这四份是「一个 URL 取回原样」的，所以只有它们进得来。
  // 判分器真正读的 wikisource 底本与脂批语料是本机加工出来的派生物，无自动重建路径，
  // 因此**不在本清单里、也不忽略**，它们直接进 git。理由见 demo/hongloumeng-c/CORPUS-SOURCES.md。
  {
    track: 'hongloumeng-c',
    file: 'demo/hongloumeng-c/corpus/pg24264-honglou.txt',
    url: 'https://www.gutenberg.org/cache/epub/24264/pg24264.txt',
    sha256: 'ff1526996bf4b81807651921a85e5c1c0f1d1d123c9fa4553057ba6a3ec72011',
    note: '《紅樓夢》120 回，第二份独立底本（异文对照用，判分器不读它）'
  },
  {
    track: 'hongloumeng-c',
    file: 'demo/hongloumeng-c/corpus/pg23962.txt',
    url: 'https://www.gutenberg.org/cache/epub/23962/pg23962.txt',
    sha256: 'af3c9e408c0c58595b666ed9981b6fa1e9343f4bbc78309b1cb0818c32fc1f58',
    note: '《西遊記》：单作者对照本。W0 用它证伪「文体统计量能分出换人」'
  },
  {
    track: 'hongloumeng-c',
    file: 'demo/hongloumeng-c/corpus/pg23863.txt',
    url: 'https://www.gutenberg.org/cache/epub/23863/pg23863.txt',
    sha256: '9d5b723b57f462545d412593870e7f48157829777b9329350a29bc44fd654789',
    note: '《水滸傳》：单作者对照本'
  },
  {
    track: 'hongloumeng-c',
    file: 'demo/hongloumeng-c/corpus/pg24032.txt',
    url: 'https://www.gutenberg.org/cache/epub/24032/pg24032.txt',
    sha256: '98a08c88b154cfef2e6a4436f124b1e29254839c04cf0bc4538ce1fc87610393',
    note: '《儒林外史》：**残缺，不可用作对照本**。第 2–11、13–18 回整段缺失，第 21 回回目重复。'
      + '留在清单里是因为它是「数据源必须先观察后使用」那条决策的实物证据，不是因为它能用'
  }
];

const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify');
const trackFilter = args.find(a => !a.startsWith('--'));

let bad = 0;
for (const m of MANIFEST) {
  if (trackFilter && m.track !== trackFilter) continue;

  if (!fs.existsSync(m.file)) {
    if (verifyOnly) { console.log(`✗ 缺失  ${m.file}`); bad++; continue; }
    fs.mkdirSync(path.dirname(m.file), { recursive: true });
    console.log(`↓ 下载  ${m.file}`);
    try {
      execFileSync('curl', ['-sL', '--max-time', '300', '-o', m.file, m.url], { stdio: 'inherit' });
    } catch {
      console.log(`✗ 下载失败  ${m.url}`);
      bad++; continue;
    }
  }

  const got = sha256(m.file);
  if (m.sha256 === null) {
    console.log(`? 无锚定指纹  ${m.file}`);
    console.log(`    当前 sha256=${got}`);
    console.log(`    ${m.note}`);
  } else if (got !== m.sha256) {
    console.log(`✗ 指纹不符  ${m.file}`);
    console.log(`    期望 ${m.sha256}`);
    console.log(`    实得 ${got}`);
    bad++;
  } else {
    console.log(`✓ ${m.file}`);
  }
}

console.log(bad ? `\n⛔ ${bad} 项有问题` : '\n✅ 语料就位，指纹相符');
process.exit(bad ? 2 : 0);
