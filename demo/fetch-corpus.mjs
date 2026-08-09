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
