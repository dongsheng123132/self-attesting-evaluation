#!/usr/bin/env node
// backtest.mjs — 回测挖掘对照跑手。
//
// 全部参数、判定规则、中止条件都在 prereg.json 里，本文件一个数字都不硬编码。
// 启动第一件事是自校验：prereg.json 的实际 sha256 必须等于 PREREGISTRATION.md 里承诺的那个。
// 于是「跑完不满意就改参数再跑」被工具挡住，不靠自觉 —— 这是判据不是建议。
//
// 观察磁盘一律走本象，不在这里另写一份 sha256（RFC-0006 §0：那是自证在本仓库复发五次的原因）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observe } from '../../benxiang/observe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const REL = 'demo/quant-preregister';

// ── 0. 自校验：预注册没被动过，才允许跑 ──────────────────────────────────────
const md = fs.readFileSync(path.join(HERE, 'PREREGISTRATION.md'), 'utf8');
const promised = md.match(/sha256 = ([0-9a-f]{64})/)?.[1] ?? null;
const actual = observe(`${REL}/prereg.json`, REPO).properties.sha256;
if (!promised) { console.error('拒跑：PREREGISTRATION.md 里找不到承诺的 sha256'); process.exit(3); }
if (promised !== actual) {
  console.error('拒跑：prereg.json 与预注册承诺的哈希不符 —— 参数在跑之前被改过。');
  console.error(`  承诺 ${promised}\n  实际 ${actual}`);
  process.exit(3);
}
const P = JSON.parse(fs.readFileSync(path.join(HERE, 'prereg.json'), 'utf8'));

// ── 1. 确定性随机：同种子同结果，不用 Math.random ────────────────────────────
const mulberry32 = a => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
/** Box–Muller：两个均匀数换一个标准正态。 */
function makeNormal(seed) {
  const r = mulberry32(seed);
  return () => {
    let u = 0; while (u === 0) u = r();          // log(0) 会炸
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
}

/** 零漂移几何布朗运动。真 alpha 严格为 0 —— 这是整个实验能裁决的前提。 */
function genPrices(seed) {
  const { n_days, start_price, daily_vol, drift } = P.data;
  const z = makeNormal(seed);
  const px = [start_price];
  for (let i = 1; i < n_days; i++) {
    px.push(px[i - 1] * Math.exp(drift - 0.5 * daily_vol ** 2 + daily_vol * z()));
  }
  return px;
}

// ── 2. 策略与指标 ────────────────────────────────────────────────────────────
const sma = (px, w) => px.map((_, i) => i < w - 1 ? null
  : px.slice(i - w + 1, i + 1).reduce((a, b) => a + b, 0) / w);

/**
 * 双均线 long-flat。t 日收盘定仓，t+1 日收益生效。
 * 返回逐日 pnl 数组（下标与价格对齐，未成交日为 null）。
 */
function dailyPnl(px, fast, slow) {
  const f = sma(px, fast), s = sma(px, slow);
  const cost = P.strategy.cost_bps_per_turn / 10000;
  const pnl = new Array(px.length).fill(null);
  let prevPos = 0;
  for (let t = 0; t < px.length - 1; t++) {
    if (f[t] === null || s[t] === null) continue;
    const pos = f[t] > s[t] ? 1 : 0;
    const ret = px[t + 1] / px[t] - 1;
    pnl[t + 1] = pos * ret - Math.abs(pos - prevPos) * cost;
    prevPos = pos;
  }
  return pnl;
}

/** 年化夏普。标准差为 0 返回 null —— 仪器失效是第三种结果，不是夏普 0。 */
function sharpe(series) {
  const x = series.filter(v => v !== null);
  if (x.length < 2) return null;
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  const v = x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1);
  if (v === 0) return null;
  return m / Math.sqrt(v) * Math.sqrt(252);
}

const grid = [];
for (const fast of P.grid.fast) for (const slow of P.grid.slow) if (fast < slow) grid.push({ fast, slow });
if (grid.length !== P.grid.n_trials) {
  console.error(`拒跑：网格实际 ${grid.length} 组，预注册写的是 ${P.grid.n_trials}`);
  process.exit(3);
}

// ── 3. 逆标准正态（Acklam 有理逼近）—— Deflated Sharpe 要用 ──────────────────
function probit(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -probit(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Bailey & López de Prado：N 次独立试验下，纯噪声预期能挖到的最大夏普。 */
function expectedMaxSharpe(sharpes) {
  const x = sharpes.filter(v => v !== null);
  const N = x.length;
  if (N < 2) return null;
  const m = x.reduce((a, b) => a + b, 0) / N;
  const V = x.reduce((a, b) => a + (b - m) ** 2, 0) / (N - 1);
  const g = P.deflated_sharpe.gamma;
  return Math.sqrt(V) * ((1 - g) * probit(1 - 1 / N) + g * probit(1 - 1 / (N * Math.E)));
}

// ── 4. 三条臂 ────────────────────────────────────────────────────────────────
const [isA, isB] = P.split.in_sample;
const [osA, osB] = P.split.out_of_sample;
const seg = (pnl, a, b) => pnl.slice(a, b + 1);

const failures = { instrument_failure: 0, zero_std: 0, seeds_dropped: 0 };
const rows = [];

for (const seed of P.data.seeds) {
  const px = genPrices(seed);
  const all = grid.map(g => {
    const pnl = dailyPnl(px, g.fast, g.slow);
    return { ...g, in: sharpe(seg(pnl, isA, isB)), out: sharpe(seg(pnl, osA, osB)), full: sharpe(pnl) };
  });

  const usable = all.filter(t => t.in !== null && t.out !== null && t.full !== null);
  failures.zero_std += all.length - usable.length;
  if (usable.length < 2) { failures.seeds_dropped++; failures.instrument_failure++; continue; }

  // P：只看样本内选参 → 样本外只跑一次
  const pPick = usable.reduce((a, b) => b.in > a.in ? b : a);
  // F：看着全样本挑最好的，把那个成绩当业绩
  const fPick = usable.reduce((a, b) => b.full > a.full ? b : a);
  // N：不看数据，PRNG 从网格里取一组
  const nPick = usable[Math.floor(mulberry32(seed ^ 0x5EED)() * usable.length)];

  rows.push({
    seed,
    P: { fast: pPick.fast, slow: pPick.slow, in_sample: pPick.in, reported: pPick.out },
    F: { fast: fPick.fast, slow: fPick.slow, reported: fPick.full },
    N: { fast: nPick.fast, slow: nPick.slow, reported: nPick.out },
    expected_max_sharpe_under_null: expectedMaxSharpe(usable.map(t => t.full))
  });
}

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const sd = xs => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const col = (arm, k = 'reported') => rows.map(r => r[arm][k]);

const summary = {
  seeds_run: rows.length,
  P: { mean: mean(col('P')), sd: sd(col('P')) },
  F: { mean: mean(col('F')), sd: sd(col('F')) },
  N: { mean: mean(col('N')), sd: sd(col('N')) },
  P_in_sample: { mean: mean(col('P', 'in_sample')), sd: sd(col('P', 'in_sample')) },
  expected_max_sharpe_under_null: { mean: mean(rows.map(r => r.expected_max_sharpe_under_null)) },
  mining_premium: mean(col('F')) - mean(col('P'))
};

// ── 5. 判定：规则跑之前就写死，这里只执行，不叙事 ────────────────────────────
const env = {
  'mean(F.sharpe) > 0.5': summary.F.mean > 0.5,
  'abs(mean(P.sharpe) - mean(N.sharpe)) < 0.30': Math.abs(summary.P.mean - summary.N.mean) < 0.30,
  'mean(F.sharpe) - mean(P.sharpe) > 0.5': summary.mining_premium > 0.5,
  'mean(F.sharpe) <= mean(F.expected_max_sharpe_under_null)':
    summary.F.mean <= summary.expected_max_sharpe_under_null.mean
};
const verdicts = P.decision_rules.map(r => ({
  id: r.id, test: r.test, passed: env[r.test] ?? null,
  conclusion: env[r.test] === undefined ? '⚠ 规则未被跑手实现' : (env[r.test] ? r.then : r.else)
}));

const aborts = [
  { id: 'A1', test: 'abs(mean(P.sharpe)) > 0.5', fired: Math.abs(summary.P.mean) > 0.5 },
  { id: 'A2', test: 'instrument_failures > 5%', fired: failures.instrument_failure > 0.05 * P.data.seeds.length }
].map(a => ({ ...a, then: P.abort_conditions.find(x => x.id === a.id).then }));

// 结果文件不含任何时间字段 —— 时间只在 .ots 里。
const out = {
  kind: 'quant.results', spec: '2origin/0.1', id: P.id,
  preregistration_sha256: actual,
  grid_size: grid.length,
  summary, verdicts, aborts, failures, rows
};
fs.writeFileSync(path.join(HERE, 'RESULTS.json'), JSON.stringify(out, null, 2) + '\n');

const f3 = x => x === null ? 'n/a' : x.toFixed(3);
console.log(`预注册校验通过  sha256=${actual.slice(0, 16)}…`);
console.log(`种子 ${rows.length}/${P.data.seeds.length}　网格 ${grid.length} 组　仪器失效 ${failures.instrument_failure}　零方差 ${failures.zero_std}　丢弃种子 ${failures.seeds_dropped}`);
console.log('');
console.log('臂                        夏普均值    标准差');
console.log(`  F 自由挖掘（全样本选参）  ${f3(summary.F.mean).padStart(8)}  ${f3(summary.F.sd).padStart(8)}`);
console.log(`  P 预注册（样本外）        ${f3(summary.P.mean).padStart(8)}  ${f3(summary.P.sd).padStart(8)}`);
console.log(`  N 地板（瞎选，样本外）    ${f3(summary.N.mean).padStart(8)}  ${f3(summary.N.sd).padStart(8)}`);
console.log(`  P 的样本内成绩（对照）    ${f3(summary.P_in_sample.mean).padStart(8)}  ${f3(summary.P_in_sample.sd).padStart(8)}`);
console.log('');
console.log(`挖掘溢价 F − P = ${f3(summary.mining_premium)}`);
console.log(`纯噪声下 ${grid.length} 次试验的期望最大夏普 = ${f3(summary.expected_max_sharpe_under_null.mean)}`);
console.log('');
for (const v of verdicts) console.log(`  ${v.passed ? '✔' : '✘'} ${v.id}  ${v.conclusion}`);
for (const a of aborts) if (a.fired) console.log(`  🛑 ${a.id} 触发：${a.then}`);
console.log('');
console.log('→ demo/quant-preregister/RESULTS.json');
process.exit(aborts.some(a => a.fired) ? 4 : 0);
