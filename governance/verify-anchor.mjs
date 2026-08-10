#!/usr/bin/env node
// verify-anchor.mjs — 证据锚定判据（governance/anchor/0.1）
//
// 17 条判据，其中 12 条是反向用例。理由写在论文 §5 class C：
// 「一个从没响过的守卫，和一个坏掉的守卫，从外面看没有区别」——.gitignore 那条整整
// 空转了一个仓库的寿命就是这么来的。所以每个守卫都必须有一条「它不响就红」的判据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { observe, compare } from '../benxiang/observe.mjs';
import { buildManifest, manifestFrom, serialize, listAnchors, INCLUDE_RULES, EXCLUDE_RULES } from './anchor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const results = [];
const t = (id, desc, fn) => {
  try { const r = fn(); results.push({ id, desc, ok: r === true, detail: r === true ? '' : String(r) }); }
  catch (e) { results.push({ id, desc, ok: false, detail: 'EXCEPTION: ' + e.message }); }
};

// ── 造一个最小的临时仓库，负例在这里做，绝不动真盘 ──────────────────────────
function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-'));
  fs.mkdirSync(path.join(d, 'papers'), { recursive: true });
  fs.mkdirSync(path.join(d, 'rfcs'), { recursive: true });
  fs.mkdirSync(path.join(d, 'demo/.benjing-backups'), { recursive: true });
  fs.mkdirSync(path.join(d, 'demo/book-project'), { recursive: true });
  fs.mkdirSync(path.join(d, 'demo/t1/hidden'), { recursive: true });
  fs.mkdirSync(path.join(d, 'demo/t1/corpus'), { recursive: true });
  fs.writeFileSync(path.join(d, 'papers/p.md'), 'paper body\n');
  fs.writeFileSync(path.join(d, 'rfcs/r.md'), 'rfc body\n');
  fs.writeFileSync(path.join(d, 'demo/.benjing-backups/1-t1-v1.json'), '{"a":1}\n');
  fs.writeFileSync(path.join(d, 'demo/.benjing-backups/2-book-project-v3.json'), '{"secret":"客户原稿"}\n');
  fs.writeFileSync(path.join(d, 'demo/t1/task.origin.json'), '{"kind":"task.origin"}\n');
  fs.writeFileSync(path.join(d, 'demo/book-project/draft.md'), '客户真实稿件\n');
  fs.writeFileSync(path.join(d, 'demo/t1/hidden/H.json'), '{"hidden":true}\n');
  fs.writeFileSync(path.join(d, 'demo/t1/corpus/big.txt'), 'corpus\n');
  return d;
}
const rmrf = d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } };

// ── A1 确定性与「不自证时间」 ───────────────────────────────────────────────
t('A1.1', '同样磁盘状态构造两次，清单逐字节相同', () => {
  const d = sandbox();
  try { return serialize(buildManifest(d)) === serialize(buildManifest(d)) || '两次构造不同'; }
  finally { rmrf(d); }
});
t('A1.2', '【反向】清单里不得出现任何时间字段——自证时间正是本部件要治的病', () => {
  const d = sandbox();
  try {
    const txt = serialize(buildManifest(d));
    const hits = [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, /"observed_at"/, /"built_at"/, /"mtime"/, /"generated"/]
      .filter(re => re.test(txt)).map(String);
    return hits.length === 0 || '清单自己声称了时间：' + hits.join(' ');
  } finally { rmrf(d); }
});
t('A1.3', '【反向】清单不得携带观察者身份（pid/cwd 会让同盘两次结果不同）', () => {
  const d = sandbox();
  try {
    const txt = serialize(buildManifest(d));
    return (!/"pid"/.test(txt) && !/"observer"/.test(txt) && !/"cwd"/.test(txt)) || '清单混入了观察者身份';
  } finally { rmrf(d); }
});

// ── A2 漂移检测必须真的会响 ─────────────────────────────────────────────────
t('A2.1', '【反向】改一个字节，比对必须判 drifted（不响=守卫空转）', () => {
  const d = sandbox();
  try {
    const m = buildManifest(d);
    const e = m.entries.find(x => x.path === 'papers/p.md');
    fs.writeFileSync(path.join(d, 'papers/p.md'), 'paper body TAMPERED\n');
    const v = compare(observe('papers/p.md', d), { sha256: e.sha256, size_bytes: e.size_bytes });
    return v.verdict === 'drifted' || `篡改未被发现：${v.verdict}`;
  } finally { rmrf(d); }
});
t('A2.2', '【反向】删掉被锚定的文件，比对必须判 gone', () => {
  const d = sandbox();
  try {
    const m = buildManifest(d);
    const e = m.entries.find(x => x.path === 'rfcs/r.md');
    fs.rmSync(path.join(d, 'rfcs/r.md'));
    const v = compare(observe('rfcs/r.md', d), { sha256: e.sha256, size_bytes: e.size_bytes });
    return v.verdict === 'gone' || `消失未被发现：${v.verdict}`;
  } finally { rmrf(d); }
});
t('A2.3', '【反向】只改大小不改内容不可能发生，但同名不同内容必须判出来（防止只比 size）', () => {
  const d = sandbox();
  try {
    const m = buildManifest(d);
    const e = m.entries.find(x => x.path === 'papers/p.md');
    fs.writeFileSync(path.join(d, 'papers/p.md'), 'PAPER BODY\n'); // 同长度，不同内容
    const o = observe('papers/p.md', d);
    return (o.properties.size_bytes === e.size_bytes && compare(o, { sha256: e.sha256 }).verdict === 'drifted')
      || '等长改写没被发现——说明比对退化成了只比长度';
  } finally { rmrf(d); }
});

// ── A3 隐私边界：锚定即公开，客户数据一旦进清单就没法撤回 ────────────────────
t('A3.1', '【反向】客户工作区的备份不得进入清单', () => {
  const d = sandbox();
  try {
    const m = buildManifest(d);
    const leaked = m.entries.filter(e => /book-project/.test(e.path));
    return leaked.length === 0 || '泄露：' + JSON.stringify(leaked.map(e => e.path));
  } finally { rmrf(d); }
});
t('A3.2', '【反向】客户原稿目录 / 隐藏判据集 / 语料都不得进入清单', () => {
  const d = sandbox();
  try {
    const m = buildManifest(d);
    const leaked = m.entries.filter(e => /^demo\/book-project\/|\/hidden\/|\/corpus\//.test(e.path));
    return leaked.length === 0 || '泄露：' + JSON.stringify(leaked.map(e => e.path));
  } finally { rmrf(d); }
});
t('A3.3', '【反向】排除项只出计数不出路径（列名字本身就是泄露）', () => {
  const d = sandbox();
  try {
    // 判据必须比「出现敏感词」更准：规则 id 本来就叫 corpus/hidden-judgeset，
    // 按关键词判会对一切都响 —— 那是论文 §5 class F。改判结构：键必须是已声明的规则 id，值必须是纯数字。
    const ex = buildManifest(d).excluded_by_rule;
    const known = new Set(EXCLUDE_RULES.map(r => r.id));
    const badKey = Object.keys(ex).filter(k => !known.has(k));
    const badVal = Object.entries(ex).filter(([, v]) =>
      typeof v !== 'object' || Object.values(v).some(n => typeof n !== 'number'));
    return (badKey.length === 0 && badVal.length === 0)
      || `未声明的键 ${JSON.stringify(badKey)} / 非计数的值 ${JSON.stringify(badVal)}`;
  } finally { rmrf(d); }
});
t('A3.4', '排除优先于收录：同时命中两类规则时必须被排除', () => {
  // 2-book-project-v3.json 同时命中 benjing-backups(收录) 与 private-backups(排除)
  const inc = INCLUDE_RULES.find(r => r.test('demo/.benjing-backups/2-book-project-v3.json'));
  const exc = EXCLUDE_RULES.find(r => r.test('demo/.benjing-backups/2-book-project-v3.json'));
  const d = sandbox();
  try {
    const got = buildManifest(d).entries.some(e => e.path.includes('book-project'));
    return (inc && exc && !got) || `收录=${inc?.id} 排除=${exc?.id} 进清单=${got}`;
  } finally { rmrf(d); }
});

// ── A4 丢弃必须报数 ─────────────────────────────────────────────────────────
t('A4.1', '【反向】候选在枚举后消失（并发会话删文件）必须进 unreadable 并计数，不得静默变小', () => {
  const d = sandbox();
  try {
    // 复刻论文案例 8 的触发器：路径在枚举时还在，观察时已被别的会话删掉。
    const m = manifestFrom(['papers/p.md', 'papers/vanished.md'], {}, d);
    const declared = m.unreadable.some(u => u.path === 'papers/vanished.md');
    const notEntry = !m.entries.some(e => e.path === 'papers/vanished.md');
    const counted = m.counts.unreadable === m.unreadable.length && m.counts.unreadable === 1;
    return (declared && notEntry && counted)
      || `declared=${declared} absent=${notEntry} count=${m.counts.unreadable}/${m.unreadable.length}`;
  } finally { rmrf(d); }
});
t('A4.4', '【反向】所有候选都消失时，清单必须是「0 条 + 报数 N」，不是「静默的空清单」', () => {
  const d = sandbox();
  try {
    const m = manifestFrom(['a.md', 'b.md', 'c.md'], {}, d);
    return (m.counts.entries === 0 && m.counts.unreadable === 3)
      || `entries=${m.counts.entries} unreadable=${m.counts.unreadable}`;
  } finally { rmrf(d); }
});
t('A4.2', '【反向】被剪枝的子树不得被报成「1 个文件」', () => {
  const d = sandbox();
  try {
    const m = buildManifest(d);
    const pw = m.excluded_by_rule['private-workspace'];
    return (pw && pw.subtrees >= 1 && pw.files === 0 && m.counts.excluded_subtrees >= 1)
      || '子树排除被当成文件计数了：' + JSON.stringify(m.excluded_by_rule);
  } finally { rmrf(d); }
});
t('A4.3', 'counts 与实际数组长度一致（硬编码计数是论文案例 9 的病）', () => {
  const d = sandbox();
  try {
    const m = buildManifest(d);
    return (m.counts.entries === m.entries.length && m.counts.unreadable === m.unreadable.length)
      || JSON.stringify(m.counts);
  } finally { rmrf(d); }
});

// ── A7 第三方可复现性：锚点若指向别人拿不到的字节，它只对我们自己有效 ──────────
t('A7.1', '【反向】非 git 目录必须标 unknown，不许猜成「可复现」', () => {
  const d = sandbox();
  try {
    const m = buildManifest(d);
    const lying = m.entries.filter(e => e.repro !== 'unknown');
    return (m.git_head === null && lying.length === 0)
      || `git_head=${m.git_head} 非 unknown 的条目 ${lying.length} 条：${JSON.stringify(lying.slice(0, 2))}`;
  } finally { rmrf(d); }
});
t('A7.2', '【反向】未跟踪文件不得被算进「第三方可复现」', () => {
  // 真仓库里跑：本仓库常年有并发会话写入的未跟踪文件
  const m = buildManifest(REPO);
  const bad = m.entries.filter(e => e.repro === 'git' && !fs.existsSync(path.join(REPO, e.path)));
  const consistent = m.counts.reproducible_from_git === m.entries.filter(e => e.repro === 'git').length
    && m.counts.not_reproducible === m.entries.filter(e => e.repro === 'uncommitted' || e.repro === 'untracked').length;
  return (bad.length === 0 && consistent) || `计数与标注不一致 ${JSON.stringify(m.counts)}`;
});
t('A7.3', '可复现计数必须出现，哪怕等于总数（零也是测量结果，不是缺席）', () => {
  const m = buildManifest(REPO);
  return (typeof m.counts.reproducible_from_git === 'number' && typeof m.counts.not_reproducible === 'number')
    || JSON.stringify(m.counts);
});
t('A7.4', '【反向】归档链上的快照必须自带复现性计数，不由核验时反推', () => {
  const anchors = listAnchors();
  if (!anchors.length) return '归档链为空';
  const newest = anchors.map(a => JSON.parse(fs.readFileSync(a.json, 'utf8')))
    .filter(s => s.counts?.reproducible_from_git !== undefined);
  return newest.length > 0
    || '没有任何快照记录了复现性——核验只能靠反推，而反推会把「别人拿不到」说成「账本正常增长」';
});

// ── A5 外部时间锚：没有就必须不给绿灯 ───────────────────────────────────────
t('A5.1', '【反向】归档链为空时 verify 必须退出 3，绝不给绿灯', () => {
  const d = sandbox();
  try {
    fs.mkdirSync(path.join(d, 'governance'), { recursive: true });
    fs.mkdirSync(path.join(d, 'benxiang'), { recursive: true });
    fs.copyFileSync(path.join(HERE, 'anchor.mjs'), path.join(d, 'governance/anchor.mjs'));
    fs.copyFileSync(path.join(REPO, 'benxiang/observe.mjs'), path.join(d, 'benxiang/observe.mjs'));
    let code = 0;
    try { execFileSync(process.execPath, [path.join(d, 'governance/anchor.mjs'), 'verify'], { stdio: 'pipe' }); }
    catch (e) { code = e.status; }
    return code === 3 || `无锚点时退出码是 ${code}，应为 3`;
  } finally { rmrf(d); }
});
t('A5.2', '【反向】锚点文件名必须等于快照内容哈希，否则锚点可被改名滑动', () => {
  const anchors = listAnchors();
  if (!anchors.length) return '没有归档锚点可测（先跑 stamp）';
  const a = anchors[0];
  const real = observe(a.json, REPO).properties.sha256;
  return real.startsWith(a.id) || `文件名 ${a.id} 与内容哈希 ${real.slice(0, 16)} 对不上——锚点可被改名滑动`;
});
t('A5.3', '归档链上每个 .json 都有配套 .ots（盖了章才算锚点）', () => {
  const anchors = listAnchors();
  if (!anchors.length) return '归档链为空';
  const naked = anchors.filter(a => !observe(a.ots, REPO).properties.exists).map(a => a.id);
  return naked.length === 0 || '有快照没盖章：' + naked.join(', ');
});

// ── A6 继承本象铁律 ─────────────────────────────────────────────────────────
t('A6.1', '【反向】observe 传入预期值必须抛错（锚定不得退化成确认偏误机）', () => {
  try { observe('papers', REPO, { sha256: 'whatever' }); return '接受了预期值'; }
  catch (e) { return /预期/.test(e.message) || '抛错了但不是因为预期值：' + e.message; }
});
t('A6.2', '本部件自身不出现 crypto —— 看世界只有本象一个实现', () => {
  const src = fs.readFileSync(path.join(HERE, 'anchor.mjs'), 'utf8');
  const body = src.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
  return (!/crypto/.test(body) && !/createHash/.test(body)) || 'anchor.mjs 自己算了哈希';
});

// 判据一律同步：一条返回 Promise 的判据永远 !== true，会被静默记成失败或误判成功。
const async_ = results.filter(r => r.detail.includes('[object Promise]'));
if (async_.length) { console.error('判据实现错误：以下判据返回了 Promise：' + async_.map(r => r.id).join(',')); process.exit(1); }

const pass = results.filter(r => r.ok).length;
console.log(`\n═══ 证据锚定判据（governance/anchor/0.1）═══\n`);
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.id.padEnd(6)} ${r.desc}`);
  if (!r.ok) console.log(`        └─ ${r.detail}`);
}
const neg = results.filter(r => r.desc.includes('【反向】')).length;
console.log(`\n判决：${pass}/${results.length}（其中反向用例 ${neg} 条）${pass === results.length ? ' ✅ VERIFIED' : ' ❌ NOT VERIFIED'}`);
process.exit(pass === results.length ? 0 : 1);
