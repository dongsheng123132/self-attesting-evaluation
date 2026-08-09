#!/usr/bin/env node
// 隐藏判据集的封条。
//
// 封条要解决的问题只有一个：**证明 H 在第一次生成之前就已经固定**。
// 事后调判据是这类实验最容易、也最查不出来的作弊方式（codex 独立审视把它列为
// 85% 概率的致命缺陷，见 demo/ulysses-19/reviews/codex-review-2026-08-09.md）。
//
// 机制：SEAL.json 进 git，H 本身 gitignore。权威时间戳不是 SEAL.json 里的字段，
// 而是**它那次 git commit 的时间**——字段可以改，提交历史改不了而不留痕。
// 任何人可以：重跑 build-hidden.mjs → 重建 H → 与 SEAL 里的 sha256 比对。
//
// 用法：
//   node demo/holmes-untold/seal.mjs --create   # 生成/更新封条（跑生成实验前做一次）
//   node demo/holmes-untold/seal.mjs --verify   # 重建 H 并核对封条
// 退出码：0 = 相符  2 = 不符（H 被改过）  1 = 用法/缺文件

import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const HIDDEN = 'demo/holmes-untold/hidden/constraints-hidden.json';
const BUILDER = 'demo/holmes-untold/build-hidden.mjs';
const SEAL = 'demo/holmes-untold/SEAL.json';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

function rebuild() {
  // 重建到内存，不覆盖盘上的 H——校验不该有副作用。
  return execFileSync('node', [BUILDER, '--stdout'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .replace(/\n$/, '');   // console.log 会补一个换行，盘上文件没有
}

const mode = process.argv[2];

if (mode === '--create') {
  if (!fs.existsSync(HIDDEN)) { console.error(`缺 ${HIDDEN}，先跑 node ${BUILDER}`); process.exit(1); }
  const body = fs.readFileSync(HIDDEN, 'utf8');
  const h = JSON.parse(body);
  const seal = {
    spec: 'holmes-untold/seal-v1',
    note: '本文件封存隐藏判据集 H 的指纹。权威时间戳是本文件的 git commit 时间，不是任何字段。',
    hidden_file: HIDDEN,
    hidden_sha256: sha(body),
    builder: BUILDER,
    builder_sha256: sha(fs.readFileSync(BUILDER)),
    counts: {
      canon_and_chronology: h.H1_H4_canon.length,
      cross_instance: h.H2_cross_instance.length,
      seed_fidelity: h.H3_seed_fidelity.length,
      dropped_unanchored: h.dropped_unanchored.length
    },
    primary_endpoint: h.primary_endpoint,
    corpus_sha256: h.built_from,
    how_to_verify: `node ${BUILDER} --stdout | 去掉末尾换行后取 sha256，应等于 hidden_sha256`
  };
  fs.writeFileSync(SEAL, JSON.stringify(seal, null, 2));
  console.log(`封条已写入 ${SEAL}`);
  console.log(`hidden_sha256 = ${seal.hidden_sha256}`);
  console.log('提醒：SEAL.json 必须在跑第一次生成之前提交，否则封条不成立。');
  process.exit(0);
}

if (mode === '--verify') {
  if (!fs.existsSync(SEAL)) { console.error(`缺封条 ${SEAL}`); process.exit(1); }
  const seal = JSON.parse(fs.readFileSync(SEAL, 'utf8'));
  const problems = [];

  const builderNow = sha(fs.readFileSync(BUILDER));
  if (builderNow !== seal.builder_sha256) {
    problems.push(`构造脚本已被修改：封存时 ${seal.builder_sha256.slice(0, 16)}… 现在 ${builderNow.slice(0, 16)}…`);
  }

  const rebuilt = sha(Buffer.from(rebuild(), 'utf8'));
  if (rebuilt !== seal.hidden_sha256) {
    problems.push(`重建的 H 与封条不符：封条 ${seal.hidden_sha256.slice(0, 16)}… 重建 ${rebuilt.slice(0, 16)}…`);
  }

  if (fs.existsSync(HIDDEN)) {
    const onDisk = sha(fs.readFileSync(HIDDEN));
    if (onDisk !== seal.hidden_sha256) problems.push(`盘上的 H 文件与封条不符（${onDisk.slice(0, 16)}…）`);
  } else {
    console.log(`（盘上无 ${HIDDEN}，仅校验重建结果——这是正常的，H 不进 git）`);
  }

  if (problems.length) {
    console.log('\n⛔ 封条不符：');
    for (const p of problems) console.log('  • ' + p);
    console.log('\n这意味着 H 在封存之后被改动过。若已跑过生成实验，其结论不再成立。');
    process.exit(2);
  }
  console.log('✅ 封条相符：H 与封存时逐字节一致');
  console.log(`   hidden_sha256 = ${seal.hidden_sha256}`);
  console.log(`   主要终点 = ${seal.primary_endpoint}，判据数 ${JSON.stringify(seal.counts)}`);
  process.exit(0);
}

console.error('用法: node demo/holmes-untold/seal.mjs --create | --verify');
process.exit(1);
