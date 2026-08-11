#!/usr/bin/env node
// verify-selfref.mjs — 自指废话探针（selfref/0.1）
//
// 起因：2026-08-11 一天之内，同一个形状的错误犯了三次——
//   ① 改名时全局替换把「讲改名那一段里的旧名」也换掉了，于是标题变成
//      「「确认台」改名为「确认台」」，表格里出现「确认台（原「确认台」）」
//   ② `git add -A` 把另一个会话的 1000+ 行工作裹进了一个叫「术语同步」的 commit
//   ③ 替换又误伤了「已知的名实不符」一节里本该保留的目录内文件名
//
// **同病复发三次不是不小心，是缺了一个部件**（bugscope：同病复发 N 次 ⇒ 缺部件）。
// 共同结构是：一个批量操作没有声明自己的边界，于是波及了不该波及的东西。
// 而「事前边界 + 事后披露」这一对，在锚定（EXCLUDE_RULES）、影核（风险分级 + 写后回读）、
// 北桥（投影必须披露丢了什么）里都有——**唯独批量文本替换没有**。
//
// 本文件只解决其中可机检的那一半：改名后留在文档里的**自指废话**。
// 它抓不到 ②（提交范围），那条只能靠铁律，已写进 CLAUDE.md。
//
//   node governance/verify-selfref.mjs [额外要扫的目录…]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SKIP = new Set(['node_modules', '.git', '.claude', 'corpus', 'anchors', '.benjing-backups']);

/**
 * 自指模式。每条都必须能给出「同一个词出现在两侧」的证据，
 * 而不是「看起来像废话」——探针对什么都报警就等于什么都没测。
 */
export const SELFREF_RULES = [
  {
    id: 'rename-to-self',
    desc: '「X 改名为 X」——改名说明里的旧名被同一次替换吃掉了',
    re: /「([^」]{1,20})」\s*改名为\s*「\1」/g
  },
  {
    id: 'formerly-self',
    desc: '「X（原「X」）」——消歧标注指向了自己',
    re: /([^\s（(|「」]{1,20})\s*[（(]\s*原\s*「?\1」?\s*[)）]/g
  },
  {
    id: 'alias-self',
    desc: '「X 曾用名：X」——曾用名与当前名相同',
    re: /([^\s|]{1,20})\s+曾用名[：:]\s*\1(?![^\s|，。])/g
  },
  {
    id: 'en-formerly-self',
    desc: '"X (formerly X)" —— 英文侧同型',
    re: /\b([A-Za-z][\w .-]{1,28}?)\s*\(\s*formerly\s+\1\s*\)/gi
  }
];

/**
 * 只看文本，不猜意图。返回 {file, line, rule, text} 列表。
 *
 * **首跑教训**：S1 当场绿了（仓库里确实已无自指废话），而 S2 揭穿它是**假绿**——
 * 四条模式里有三条根本抓不住自己的病例。病因同一个：markdown 的 `**` 夹在中间，
 * 于是 `**确认台**` 与括号里的 `确认台` 在正则看来不是同一个词，反向引用永远对不上。
 *
 * **如果没有 S2，这个探针会以「全绿」的姿态永远躺在判据清单里。**
 * 恒绿考题正是学堂那组判据批的东西，它差点在这里复发一次。
 * 所以：先剥掉强调标记再匹配，报告时仍用原行。
 */
const normalize = l => l.replace(/\*\*|\*|`/g, '').replace(/<br\s*\/?>/gi, ' ');

/**
 * 豁免标记。**讲病的文字天然含有病**——这与「讲改名的段落含有旧名」完全同构，
 * 是同一个盲区换了一层。首次跨仓库实跑就撞上了：本象协议里那段如实记录改名事故的
 * 自嘲文字被报成病例。
 *
 * 解法照抄本境的 `__allow_loss`：**不禁止，但必须显式声明**，且豁免要出现在报告里
 * （排除项只出计数不出内容是锚定那边的规矩；这里条数少，直接给行号，便于复核）。
 * 写法：在该行或紧邻的上一行放 `<!-- selfref:example -->`。
 */
export const EXEMPT_MARK = 'selfref:example';

export function scanText(rel, text) {
  // 本文件自己列举病例，天然含有这些模式——排除自身，否则探针永远报自己。
  if (rel.endsWith('verify-selfref.mjs')) return [];
  const hits = [], exempt = [];
  const lines = text.split(/\r?\n/);
  // 豁免覆盖**从标记到下一个空行为止的整段**，不是只覆盖紧邻的一行。
  // 首版只看当前行与上一行，结果标记放在段首、病例出现在段落第三行时照样报——
  // 讲一次事故通常要好几行，按行豁免等于要求作者在每一行都贴标记。
  const exemptLines = new Set();
  lines.forEach((l, i) => {
    if (!l.includes(EXEMPT_MARK)) return;
    for (let j = i; j < lines.length; j++) {
      if (j > i && lines[j].trim() === '') break;
      exemptLines.add(j);
    }
  });
  const exempted = i => exemptLines.has(i);
  for (const rule of SELFREF_RULES) {
    lines.forEach((l, i) => {
      const norm = normalize(l);
      rule.re.lastIndex = 0;
      if (!rule.re.test(norm)) return;
      const rec = { file: rel, line: i + 1, rule: rule.id, text: l.trim().slice(0, 110) };
      if (exempted(i)) exempt.push(rec); else hits.push(rec);
    });
  }
  hits.exempt = exempt;
  return hits;
}

export function scanRepo(root = REPO, exts = ['.md']) {
  const out = []; out.exempt = [];
  const walk = dir => {
    let es;
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!exts.includes(path.extname(e.name))) continue;
      const rel = path.relative(root, full).replace(/\\/g, '/');
      const h = scanText(rel, fs.readFileSync(full, 'utf8'));
      out.push(...h);
      out.exempt.push(...(h.exempt || []));
    }
  };
  walk(root);
  return out;
}

// ───────────────────────── 判据 ─────────────────────────
const results = [];
const t = (id, desc, fn) => {
  try { const r = fn(); results.push({ id, desc, ok: r === true, detail: r === true ? '' : String(r) }); }
  catch (e) { results.push({ id, desc, ok: false, detail: 'EXCEPTION: ' + e.message }); }
};

const roots = process.argv.slice(2).length ? process.argv.slice(2) : [REPO];
const scans = roots.map(r => scanRepo(path.resolve(r)));
const hits = scans.flat();
const exemptAll = scans.flatMap(s => s.exempt || []);

t('S1', '仓库文档里不存在自指废话（改名后旧名被自己的替换吃掉）', () =>
  hits.length === 0 || hits.map(h => `${h.file}:${h.line} [${h.rule}] ${h.text}`).join('\n           '));

t('S2', '【反向】四条模式都真的能抓住对应的病例（探针不是恒绿）', () => {
  const cases = [
    ['rename-to-self', '### 「确认台」改名为「确认台」'],
    ['formerly-self', '| **确认台**（原「确认台」） | 人类确认界面 |'],
    ['alias-self', '| **确认台**<br>曾用名：确认台 |'],
    ['en-formerly-self', '| **Review Console** (formerly Review Console) |']
  ];
  const missed = cases.filter(([id, line]) =>
    !scanText('fake.md', line).some(h => h.rule === id));
  return missed.length === 0 || `以下模式抓不住自己的病例：${missed.map(c => c[0]).join(', ')}`;
});

t('S3', '【反向】正常的改名说明不得被误报（写对了的写法要放行）', () => {
  const ok = [
    '### 「舟舱 / PodApp」改名为「确认台 / Review Console」',
    '| **确认台**<br>曾用名：舟舱 | **Review Console**<br>曾用名：PodApp |',
    '| Learned state | **学籍** Xueji (formerly Benli) | State Layer |',
    '取象 Quxiang · Sensor 是观察器的正名，本象只指表示层'
  ];
  const bad = ok.filter(l => scanText('fake.md', l).length);
  return bad.length === 0 || `误报了正确写法：${bad.join(' / ')}`;
});

t('S4', '【反向】扫描面不能是空的（否则 S1 恒绿）', () => {
  const n = roots.flatMap(r => {
    let c = 0;
    const walk = d => {
      let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        if (SKIP.has(e.name)) continue;
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f); else if (f.endsWith('.md')) c++;
      }
    };
    walk(path.resolve(r));
    return [c];
  }).reduce((a, b) => a + b, 0);
  return n >= 10 || `只扫到 ${n} 份 .md，S1 会因此恒绿`;
});

t('S5', '【反向】豁免必须显式：同一行去掉标记后仍要被抓住', () => {
  const line = '> 标题一度变成「「确认台」改名为「确认台」」';
  const withMark = `<!-- ${EXEMPT_MARK} -->\n${line}`;
  const marked = scanText('fake.md', withMark);
  const naked = scanText('fake.md', line);
  if (naked.length === 0) return '不带标记的病例没被抓住——S5 在测空气';
  return (marked.length === 0 && (marked.exempt || []).length > 0)
    || `带标记时应转入豁免而非命中：hits=${marked.length} exempt=${(marked.exempt || []).length}`;
});

const pass = results.filter(r => r.ok).length;
console.log('\n═══ 自指废话探针（selfref/0.1）═══');
console.log(`扫描根：${roots.map(r => path.relative(REPO, path.resolve(r)) || '.').join(', ')}`);
// 豁免必须被披露，否则「显式声明」就退化成「悄悄关掉」——
// 这是北桥那条「投影必须披露自己丢了什么」的同一条规矩。
if (exemptAll.length) {
  console.log(`显式豁免 ${exemptAll.length} 处（标记 ${EXEMPT_MARK}）：`);
  for (const e of exemptAll) console.log(`  · ${e.file}:${e.line} [${e.rule}]`);
}
console.log('');
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.id.padEnd(4)} ${r.desc}`);
  if (!r.ok) console.log(`        └─ ${r.detail}`);
}
console.log(`\n判决：${pass}/${results.length} ${pass === results.length ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
process.exit(pass === results.length ? 0 : 1);
