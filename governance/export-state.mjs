#!/usr/bin/env node
// 只向 stdout 输出经过治理策略构造的发布对象；不提供“原样复制学历”的后门。
import fs from 'node:fs';
import { buildPublishableExport } from './policy.mjs';

const file = process.argv[2];
if (!file || process.argv.includes('--help')) {
  console.error('用法: node governance/export-state.mjs <task.origin.json> [--compact]');
  process.exit(file ? 0 : 1);
}

let state;
try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error(`拒绝导出：输入无法读取或解析（${e.message}）`); process.exit(4); }

const result = buildPublishableExport(state);
if (!result.ok) { console.error(`拒绝导出：${result.reason}`); process.exit(3); }
process.stdout.write(JSON.stringify(result.document, null, process.argv.includes('--compact') ? 0 : 2) + '\n');
