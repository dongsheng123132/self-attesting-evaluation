// 实弹演习：蓄意破坏本象文本观察，验证 verify-observe-text.mjs 会不会变红。
// 绿的验证器不值钱，能变红的才值钱。跑完自动还原。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const P = 'benxiang/observe-text.mjs';
const orig = fs.readFileSync(P, 'utf8');

const FAULTS = [
  {
    name: 'F1 换行不再折叠成空格（等价于退回逐行匹配）',
    from: `    const ws = ch === ' ' || ch === '\\t' || ch === '\\n' || ch === '\\r' || ch === '\\f' || ch === '\\v';`,
    to: `    const ws = ch === ' ' || ch === '\\t';`
  },
  {
    name: 'F2 不再把下划线当零宽（UC17 的原病）',
    from: `    if (drop.has(ch)) { dropped++; continue; }`,
    to: `    if (false) { dropped++; continue; }`
  },
  {
    name: 'F3 行号映射错位一行',
    from: `      out.push(ch); lineAt.push(line); prevSpace = false;`,
    to: `      out.push(ch); lineAt.push(line + 1); prevSpace = false;`
  },
  {
    name: 'F4 拿掉独立性守卫（允许塞入预期）',
    from: `  if (arguments.length > 2) {`,
    to: `  if (false) {`
  }
];

let allDiscriminated = true;
for (const f of FAULTS) {
  if (!orig.includes(f.from)) {
    console.log(`⚠ ${f.name}：锚点没匹配上，本次注入无效——不作数`);
    allDiscriminated = false;
    continue;
  }
  fs.writeFileSync(P, orig.replace(f.from, f.to));
  // 确认破坏确实落盘了
  const after = fs.readFileSync(P, 'utf8');
  if (after === orig) { console.log(`⚠ ${f.name}：写入后文件未变，不作数`); allDiscriminated = false; continue; }

  let exit = 0, out = '';
  try {
    out = execFileSync('node', ['benxiang/verify-observe-text.mjs'], { encoding: 'utf8' });
  } catch (e) {
    exit = e.status; out = e.stdout || '';
  }
  const failed = (out.match(/^❌/gm) || []).map(() => 1).length;
  // 只取行首的 ❌（判据行）。不加锚点会把末尾「判决：… ❌ NOT VERIFIED」也算成一条判据 ID。
  const ids = [...out.matchAll(/^❌ (\S+)/gm)].map(m => m[1]);
  if (exit === 0) {
    console.log(`❌ ${f.name}：验证器仍然全绿——这条判据是假考题`);
    allDiscriminated = false;
  } else {
    console.log(`✅ ${f.name}：验证器变红，${failed} 条判据失败 [${ids.join(' ')}]`);
  }
  fs.writeFileSync(P, orig);
}

fs.writeFileSync(P, orig);
console.log(fs.readFileSync(P, 'utf8') === orig ? '\n已还原' : '\n⛔ 还原失败，手工检查 ' + P);
console.log(allDiscriminated ? '✅ 四种破坏全部被抓住' : '⛔ 有破坏没被抓住');
process.exit(allDiscriminated ? 0 : 1);
