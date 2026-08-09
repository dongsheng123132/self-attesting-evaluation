// not-runnable.mjs — 「命令根本没跑起来」的识别（学堂 xuetang/0.1）
//
// 为什么要单独一个模块：spawn 成功 ≠ 命令跑起来了。
// `node 不存在的脚本.mjs` 会正常启动、正常退出，退出码 1 —— 与「断言失败」完全一样。
// 于是「考题脚本还没写」被判成「这条经验错了」，正是 exam.mjs 开头明令禁止的：
//
//   跑不起来 ≠ 跑挂了。把 error 当 fail 会让「环境坏了」冒充「经验错了」，
//   那是新的自证来源。
//
// 实测触发过：两条经验的 recheck 指向尚未编写的 calibrate.mjs，考试判 fail。
//
// **判宽比判窄更危险**：把真失败洗成 error，经验就永不降级，学堂失去全部意义。
// 本模块第一版只做 stderr 关键字匹配，被判据 X3.6 当场抓住——一个在业务输出里
// 打印「Cannot find module」字样的真失败会被误判。所以现在分两道：
//   1. 起飞前检查（preflight）：脚本文件在不在，是确定性事实，不靠字符串猜
//   2. 起飞后模式（isNotRunnable）：只认解释器内部标记，不认自由文本

import fs from 'node:fs';
import path from 'node:path';

const INTERPRETERS = new Set(['node', 'node.exe', 'python', 'python3', 'python.exe', 'bash', 'sh']);
const SCRIPT_EXT = /\.(mjs|cjs|js|py|sh)$/i;

/**
 * 起飞前检查：命令要跑的脚本文件存不存在。
 * 这是确定性事实，比事后猜 stderr 可靠得多。
 * @returns {string|null} 跑不起来的理由；null 表示看不出问题（不代表一定能跑）
 */
export function preflight(argv, root = process.cwd()) {
  if (!Array.isArray(argv) || !argv.length) return null;
  const head = path.basename(String(argv[0])).toLowerCase();
  if (!INTERPRETERS.has(head)) return null;          // 不是「解释器 + 脚本」形态，管不着
  const target = argv.slice(1).find(a => !String(a).startsWith('-') && SCRIPT_EXT.test(String(a)));
  if (!target) return null;
  const abs = path.isAbsolute(target) ? target : path.resolve(root, target);
  return fs.existsSync(abs) ? null : `脚本不存在：${target}`;
}

// 只认解释器/运行时自己吐出的**结构化**标记。
// 刻意不匹配裸的 "Cannot find module" —— 那串字任何业务输出都可能打印。
export const NOT_RUNNABLE = [
  { rx: /code:\s*'MODULE_NOT_FOUND'/, why: '脚本或依赖不存在' },
  { rx: /\[ERR_MODULE_NOT_FOUND\]/, why: '脚本或依赖不存在' },
  // 这里曾经有一条 /at .*node:internal\/modules\// ——「栈里出现模块加载帧就算加载失败」。
  // 它错得很典型：**任何** ESM 里的未捕获异常，栈底都有 ModuleJob.run 与 loader 帧。
  // 于是一个「故意抛错以示自检失败」的考题脚本（demo/hongloumeng-c/probe-seam.mjs，
  // expect_exit:1，本来判 pass）被洗成了「跑不起来」，经验从此永不降级。
  // 判宽比判窄更危险——同一个错在同一次修法里犯了第二次，删掉不再加回。
  { rx: /\[ERR_UNKNOWN_FILE_EXTENSION\]/, why: '解释器不认识这个文件类型' },
  { rx: /^(?:bash|sh): .*: command not found$/m, why: '命令不存在' },
  { rx: /is not recognized as an internal or external command/, why: '命令不存在' },
  { rx: /^\s*Error: spawn .* (ENOENT|EACCES)$/m, why: '命令不存在或没有执行权限' }
];

export const notRunnableHit = r => NOT_RUNNABLE.find(n => n.rx.test((r && r.stderr) || ''));

/**
 * 判定一次 spawnSync 结果是否属于「没跑起来」。
 * 退出码 0 却匹配到标记的不算——那不是启动失败。
 */
export const isNotRunnable = r => !!r && r.status !== 0 && !!notRunnableHit(r);

export const notRunnableReason = r => (notRunnableHit(r) || { why: '未知' }).why;
