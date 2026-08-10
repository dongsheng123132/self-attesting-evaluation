#!/usr/bin/env node
// run.mjs — M0 对照跑手。判分与重试规则见 PREREGISTRATION.md，跑之前已封存。
//
// **对预注册的偏离（如实记录）**：§3 说「同一 harness」，实际用的是本文件里这个最小 agent 循环，
// 不是 hermes。原因：本机 hermes 的活动配置在另一个 HOME 下且 config.yaml 里是占位密钥，
// 跑起来 401。与其跟它的配置考古纠缠，不如用一个工具集完全可见、可复现的循环——
// 对「学历是不是必要条件」这个问题，harness 的身份不是自变量，能不能读文件才是。
// 代价：本实验不再同时验证 harness 无关性，只验证学历必要性。
//
// 三个臂用**独立沙箱目录**，使提示词里的路径一字不改，只有「文件在不在」变。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const TRUTH = JSON.parse(fs.readFileSync(path.join(HERE, '.truth.json'), 'utf8'));
const KEY = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.uking/device.json'), 'utf8')).key;
const BASE = 'https://api.u-claw.org.cn/v1/chat/completions';
const PROXY = process.env.M0_PROXY || 'http://127.0.0.1:7897';

const PROMPT = '读 demo/control-m0/task.origin.json，接着干你负责的那一步。不要问我任务是什么。'
  + '用严格 JSON 回答，只输出一个对象：{"step":"...","cli_count":<整数>,"token":"..."}';

const MODELS = (process.env.M0_MODELS || 'deepseek-v4-flash,deepseek-v4-pro,kimi-k2.6').split(',');
const REPEATS = Number(process.env.M0_REPEATS || 3);
const ARMS = ['M3', 'M2', 'M0'];
const MAX_TOKENS = 3000;   // 推理模型会把预算烧在 reasoning token 上（案例 4），给足

// ── 工具：只有两把。count_matches 必须由调用方给窗口——窗口只在学历里 ────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file', description: '读取一个文本文件的全部内容',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'count_matches',
      description: '统计文件中第 from_line 到 to_line 行（含两端，1 起算）内包含 substring 的行数',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }, substring: { type: 'string' },
          from_line: { type: 'integer' }, to_line: { type: 'integer' }
        },
        required: ['path', 'substring', 'from_line', 'to_line']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir', description: '列出目录下的文件名',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    }
  }
];

function callTool(cwd, name, args) {
  const safe = p => {
    const abs = path.resolve(cwd, String(p || ''));
    if (!abs.startsWith(cwd)) throw new Error('path escapes sandbox');
    return abs;
  };
  try {
    if (name === 'read_file') {
      const b = fs.readFileSync(safe(args.path), 'utf8');
      return b.length > 20000 ? b.slice(0, 20000) + '\n…[truncated]' : b;
    }
    if (name === 'list_dir') return fs.readdirSync(safe(args.path)).join('\n') || '(empty)';
    if (name === 'count_matches') {
      const lines = fs.readFileSync(safe(args.path), 'utf8').split('\n');
      const lo = Math.max(1, args.from_line | 0), hi = Math.min(lines.length, args.to_line | 0);
      const n = lines.slice(lo - 1, hi).filter(l => l.includes(String(args.substring))).length;
      return String(n);
    }
    return 'unknown tool';
  } catch (e) { return 'ERROR: ' + e.message; }
}

// 请求体必须走临时文件。第一版把 JSON 塞进 -d 参数，M2/M0 两臂全线 ENAMETOOLONG——
// Windows argv 上限 32767，而**没有学历的臂正因为在翻找它们没有的信息而读得更多**，
// 于是撑爆得更频繁。若把这些计为「答错」，M2/M0 会因为一个与继承无关的原因显得更差，
// 实验当场作废。预注册 §4「仪器失效是第三种结果」是唯一让它暴露出来的东西。
function post(body) {
  const f = path.join(os.tmpdir(), `m0-req-${process.pid}-${postSeq++}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  try {
    return execFileSync('curl', ['-s', '--max-time', '180', '-x', PROXY, BASE,
      '-H', 'Authorization: Bearer ' + KEY, '-H', 'Content-Type: application/json',
      '-d', '@' + f], { encoding: 'utf8', maxBuffer: 5e7 });
  } finally { try { fs.unlinkSync(f); } catch { /* ignore */ } }
}
let postSeq = 0;

/** 一次完整会话。返回 {kind:'answer'|'instrument_failure', ...} —— 仪器失效是第三种结果。 */
function runOnce(model, arm) {
  const cwd = sandbox(arm);
  const msgs = [{ role: 'user', content: PROMPT }];
  try {
    for (let turn = 0; turn < 20; turn++) {
      let raw, j;
      for (let attempt = 0; attempt < 4; attempt++) {          // 传输/5xx/429 指数退避（案例 6）
        raw = post({ model, messages: msgs, tools: TOOLS, max_tokens: MAX_TOKENS });
        try { j = JSON.parse(raw); } catch { j = null; }
        const code = j?.error?.code ?? j?.error?.type;
        if (j && !j.error) break;
        if (typeof code === 'string' && /invalid_api_key|authentication|permission/i.test(code)) {
          throw new Error('4xx: ' + code);                     // 4xx 立刻抛，重试只会掩盖它
        }
        execFileSync(process.execPath, ['-e', `setTimeout(()=>{},${400 * (2 ** attempt)})`]);
      }
      if (!j || j.error) return { kind: 'instrument_failure', why: (raw || '').slice(0, 120) };
      const m = j.choices?.[0]?.message;
      const fin = j.choices?.[0]?.finish_reason;
      if (!m) return { kind: 'instrument_failure', why: 'no message' };
      if (m.tool_calls?.length) {
        msgs.push(m);
        for (const tc of m.tool_calls) {
          let a = {}; try { a = JSON.parse(tc.function.arguments || '{}'); } catch { /* keep {} */ }
          msgs.push({ role: 'tool', tool_call_id: tc.id, content: callTool(cwd, tc.function.name, a) });
        }
        continue;
      }
      const text = (m.content || '').trim();
      // 空 content + length：推理预算烧光，是仪器失效不是答错（案例 4/5）
      if (!text) return { kind: 'instrument_failure', why: `empty content, finish=${fin}` };
      return { kind: 'answer', text };
    }
    // turn limit **不是**仪器失效：循环工作正常，是模型在 20 回合内没给出答案。
    // 预注册 §4 的清单没有这一类（是我在代码里加的兜底），所以单列一类，两种读法都报，
    // 不挑对假设有利的那个。归成 instrument_failure 会把「没有学历就答不出来」这个
    // 我正要找的结果直接排除掉——那是与案例 18 镜像的错误。
    return { kind: 'no_answer', why: 'turn limit (20)' };
  } catch (e) {
    if (/^4xx/.test(e.message)) throw e;
    return { kind: 'instrument_failure', why: e.message.slice(0, 120) };
  } finally {
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function sandbox(arm) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `m0-${arm}-`));
  fs.mkdirSync(path.join(d, 'southbridge'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'southbridge/audit.log'), path.join(d, 'southbridge/audit.log'));
  if (arm !== 'M0') {
    fs.mkdirSync(path.join(d, 'demo/control-m0'), { recursive: true });
    fs.copyFileSync(path.join(HERE, 'leg-b-note.md'), path.join(d, 'demo/control-m0/leg-b-note.md'));
  }
  if (arm === 'M3') fs.copyFileSync(path.join(HERE, 'task.origin.json'), path.join(d, 'demo/control-m0/task.origin.json'));
  return d;
}

function parseAnswer(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const m = body.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const rows = [];
const tally = { instrument_failure: 0, retried: 0, unparseable: 0, no_answer: 0 };

for (const model of MODELS) {
  for (const arm of ARMS) {
    for (let i = 0; i < REPEATS; i++) {
      let r = runOnce(model, arm);
      if (r.kind === 'no_answer') {
        tally.no_answer++;
        rows.push({ model, arm, i, outcome: 'no_answer', why: r.why });
        process.stderr.write(`  ✗ ${model}/${arm}#${i} 20 回合未给出答案
`);
        continue;
      }
      if (r.kind === 'instrument_failure') {                   // 预注册 §4：重试一次
        tally.instrument_failure++; tally.retried++;
        process.stderr.write(`  ⚠ ${model}/${arm}#${i} 仪器失效（${r.why}），重试\n`);
        r = runOnce(model, arm);
        if (r.kind === 'instrument_failure') {
          tally.instrument_failure++;
          rows.push({ model, arm, i, outcome: 'instrument_failure', why: r.why });
          continue;
        }
        if (r.kind === 'no_answer') {
          tally.no_answer++;
          rows.push({ model, arm, i, outcome: 'no_answer', why: r.why });
          continue;
        }
      }
      const a = parseAnswer(r.text);
      if (!a) {
        tally.unparseable++;
        rows.push({ model, arm, i, outcome: 'unparseable', raw: r.text.slice(0, 200) });
        process.stderr.write(`  ? ${model}/${arm}#${i} 不可解析\n`);
        continue;
      }
      const q1 = String(a.step ?? '').toUpperCase().includes(TRUTH.expected_step);
      const q2 = Number(a.cli_count) === TRUTH.expected_cli_count;
      const q3 = String(a.token ?? '').trim() === TRUTH.nonce;
      rows.push({ model, arm, i, outcome: 'scored', q1, q2, q3, got: { step: a.step, cli_count: a.cli_count, token_len: String(a.token ?? '').length } });
      process.stderr.write(`  ${q1 ? 'Q1' : '··'}${q2 ? 'Q2' : '··'}${q3 ? 'Q3' : '··'} ${model}/${arm}#${i}\n`);
    }
  }
}

const scored = rows.filter(r => r.outcome === 'scored');
const wilson = (k, n) => {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const report = { spec: 'control-m0/0.1', prompt: PROMPT, models: MODELS, repeats: REPEATS, tally, by_arm: {} };
for (const arm of ARMS) {
  const s = scored.filter(r => r.arm === arm);
  const cell = q => {
    const k = s.filter(r => r[q]).length, n = s.length, [lo, hi] = wilson(k, n);
    return { k, n, rate: n ? +(k / n).toFixed(3) : null, wilson95: [+lo.toFixed(3), +hi.toFixed(3)] };
  };
  const na = rows.filter(r => r.arm === arm && r.outcome === 'no_answer').length;
  // 读法 A：只看给出了答案的；读法 B：把「20 回合没答上」算作三项全错。
  const cellB = q => {
    const k = s.filter(r => r[q]).length, n = s.length + na, [lo, hi] = wilson(k, n);
    return { k, n, rate: n ? +(k / n).toFixed(3) : null, wilson95: [+lo.toFixed(3), +hi.toFixed(3)] };
  };
  report.by_arm[arm] = {
    n_scored: s.length, no_answer: na,
    readingA_answered_only: { Q1_step: cell('q1'), Q2_window_count: cell('q2'), Q3_token: cell('q3') },
    readingB_no_answer_counts_as_wrong: { Q1_step: cellB('q1'), Q2_window_count: cellB('q2'), Q3_token: cellB('q3') }
  };
}
report.rows = rows;
fs.writeFileSync(path.join(HERE, 'RESULTS.json'), JSON.stringify(report, null, 2) + '\n');

console.log('\n═══ M0 对照结果 ═══');
console.log(`模型 ${MODELS.join(', ')}　每臂每模型 ${REPEATS} 次`);
console.log(`仪器失效 ${tally.instrument_failure}　重试 ${tally.retried}　不可解析 ${tally.unparseable}　未答 ${tally.no_answer}　计分 ${scored.length}`);
console.log('\n臂   n    Q1 步骤(基线25%)     Q2 窗口计数(基线≈0)   Q3 校验串(基线0)');
for (const arm of ARMS) {
  const a = report.by_arm[arm];
  const f = c => `${String(c.k).padStart(2)}/${String(c.n).padEnd(2)} ${c.n ? String(Math.round(c.rate * 100)).padStart(3) + '%' : ' --'} [${Math.round(c.wilson95[0] * 100)}-${Math.round(c.wilson95[1] * 100)}]`;
  const A = a.readingA_answered_only, B = a.readingB_no_answer_counts_as_wrong;
  console.log(`${arm} 答出${String(a.n_scored).padStart(2)} 未答${String(a.no_answer).padStart(2)}  A读法 ${f(A.Q1_step)} ${f(A.Q2_window_count)} ${f(A.Q3_token)}`);
  console.log(`${' '.repeat(15)}B读法 ${f(B.Q1_step)} ${f(B.Q2_window_count)} ${f(B.Q3_token)}`);
}
console.log('\n判读按 PREREGISTRATION.md §5，不在这里现编。RESULTS.json 已写。');
