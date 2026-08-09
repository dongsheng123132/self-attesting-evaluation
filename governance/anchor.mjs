#!/usr/bin/env node
// anchor.mjs — 证据锚定（governance/anchor/0.1）
//
// 为什么装这个：论文 papers/self-attesting-evaluation.md §7 自陈的最重弱点是
// 「一半证据不在版本控制下，且由被记录的系统自己产生」。2026-08-09 起本仓库进了 git，
// 修掉了一半；剩下的一半没修——**本机 git 没有 remote，commit date 可以任意伪造**，
// 所以到此刻为止，这台机器上没有任何一条时间主张是外部可核的。
//
// 本部件只做一件事：把「此刻盘上的证据集合是什么」压成一个可核的指纹，
// 然后把这个指纹交给一个我们控制不了的东西去盖时间戳（OpenTimestamps → 比特币区块头）。
//
// 铁律（写在接口上）：
//   1. **本清单不声称时间。** 文件里没有任何时间字段。时间由同名 .ots 提供，
//      由比特币区块头背书。自己给自己写时间戳正是本论文批判的那个病。
//   2. **看世界只走本象。** 所有 exists/sha256/size 一律来自 benxiang.observe()，
//      本文件不出现 crypto。fs 只用于「枚举候选路径」（发现看哪里），不用于「判断看到了什么」。
//   3. **丢弃必须报数。** 读不了的、被策略排除的，都出计数；沉默等于谎报覆盖率。
//   4. **没盖章不给绿灯。** verify 在缺少外部时间锚时退出码 3，不是 0。
//      一个从没响过的守卫和一个坏掉的守卫，从外面看没有区别。
//
// 用法：
//   node governance/anchor.mjs build    重建清单（确定性：同样磁盘跑两次逐字节相同）
//   node governance/anchor.mjs stamp    把清单指纹提交到 OpenTimestamps 日历
//   node governance/anchor.mjs upgrade  把待定的日历承诺升级成比特币区块证明（需等 1~24h）
//   node governance/anchor.mjs verify   回盘比对 + 检查外部时间锚
//   退出码 0=一致且有外部时间锚  1=用法错  3=一致但无外部时间锚  4=与磁盘分歧
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observe, compare } from '../benxiang/observe.mjs';

export const SPEC = 'governance/anchor/0.1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// 工作副本：build 每次覆盖，可由代码重算，不进 git。
export const MANIFEST_PATH = path.join(HERE, 'anchor-manifest.json');
// 归档链：stamp 冻结一份内容寻址的快照并盖章。账本天天在长，所以锚点必须是快照而非原地覆盖，
// 否则 .ots 会在下一次 build 后立刻失效。文件名只用内容哈希，**不含日期**——
// 自己给文件起个带日期的名字仍然是自证时间，真时间只在 .ots 里。
export const ANCHOR_DIR = path.join(HERE, 'anchors');

// ── 范围：显式规则，不用 glob 引擎，好让任何人一眼看完锚了什么 ──────────────
// 排除优先于收录。排除的是客户真实工作内容与派生物——它们不该被锚定后公开。
export const EXCLUDE_RULES = [
  { id: 'private-workspace', test: r => r.startsWith('demo/book-project/') || r.startsWith('private/') },
  { id: 'private-backups', test: r => /^demo\/\.benjing-backups\/.*-book-project-v\d+\.json$/.test(r) },
  { id: 'hidden-judgeset', test: r => /^demo\/[^/]+\/hidden\//.test(r) },
  { id: 'corpus', test: r => /^demo\/[^/]+\/corpus\//.test(r) },
  { id: 'transcript', test: r => r === '.claude/trace.jsonl' },
  { id: 'derived', test: r => r.startsWith('node_modules/') || r.startsWith('.git/') || r.startsWith('.backup/') }
];

export const INCLUDE_RULES = [
  // 论文案例 8~13 的唯一凭证
  { id: 'benjing-backups', test: r => /^demo\/\.benjing-backups\/[^/]+\.json$/.test(r) },
  { id: 'task-states', test: r => /^demo\/[^/]+\/task\.origin\.json$/.test(r) },
  // 只追加账本：ACCEPTANCE.md §2 的跨模型复算全靠它们
  {
    id: 'append-only-ledgers',
    test: r => ['southbridge/audit.log', 'southbridge/idempotency.jsonl', 'southbridge/todo-closures.jsonl',
      'benxiang/observations.jsonl', 'oob/crosscheck.jsonl', 'oob/env.jsonl'].includes(r)
  },
  // 论文与协议正文：优先权主张的本体
  { id: 'papers', test: r => /^papers\/[^/]+\.md$/.test(r) },
  { id: 'rfcs', test: r => /^rfcs\/[^/]+\.md$/.test(r) },
  // 176 条判据的实现：论文 §5 的「可执行而非建议」全指向这些文件
  { id: 'verifiers', test: r => /^[a-z]+\/verify-[a-z0-9-]+\.mjs$/.test(r) },
  {
    id: 'protocol-docs',
    // README/LICENSE 是对外主张本身（许可证条款、可核验步骤），必须锚定
    test: r => ['ACCEPTANCE.md', 'TERMINOLOGY.md', 'CLAUDE.md', 'AGENTS.md', 'NAMING-REVIEW.md',
      'README.md', 'LICENSE', '.gitignore'].includes(r)
  }
];

const excludedBy = rel => EXCLUDE_RULES.find(x => x.test(rel))?.id ?? null;
const includedBy = rel => INCLUDE_RULES.find(x => x.test(rel))?.id ?? null;

/**
 * 枚举候选路径。fs 在这里只回答「有哪些路径可看」，不回答「它们是什么样」——
 * 后者一律交给本象。两者混在一起就是 RFC-0006 §0 说的那个复发五次的病。
 * @returns {{paths: string[], excluded: Record<string, number>}}
 */
export function enumerate(root = ROOT) {
  const paths = [];
  const excluded = {};
  // 目录被排除时整棵子树都不展开。若只记「排除 1 个路径」，那是把一整棵树报成一条——
  // 正是论文 §5 class E（丢弃真实存在却从不申报）的形状。所以文件和子树分开计数。
  const bump = (rule, kind) => {
    const e = excluded[rule] ?? (excluded[rule] = { files: 0, subtrees: 0 });
    e[kind]++;
  };
  const walk = dir => {
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const d of names.sort((a, b) => a.name < b.name ? -1 : 1)) {
      const abs = path.join(dir, d.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      const ex = excludedBy(rel + (d.isDirectory() ? '/' : ''));
      if (ex) { bump(ex, d.isDirectory() ? 'subtrees' : 'files'); continue; }
      if (d.isDirectory()) { walk(abs); continue; }
      if (includedBy(rel)) paths.push(rel);
    }
  };
  walk(root);
  return { paths: paths.sort(), excluded };
}

/**
 * 构造清单。纯函数式产物：不含时间、不含 pid、不含 cwd —— 同样磁盘状态跑两次逐字节相同。
 */
export function buildManifest(root = ROOT) {
  const { paths, excluded } = enumerate(root);
  return manifestFrom(paths, excluded, root);
}

/**
 * 从候选路径构造清单。与 enumerate 分开是为了让「候选存在、观察却失败」这条路径可被判据直接触发——
 * 那不是假想场景：论文案例 8 的触发器就是一个并发会话在两次读之间删掉了被引用的日志。
 */
export function manifestFrom(paths, excluded = {}, root = ROOT) {
  const entries = [];
  const unreadable = [];
  for (const rel of paths) {
    let o;
    // observe 内部对 statSync 失败返回 exists:false，但 readFileSync 失败（占用/权限）会抛。
    // 抛出来必须算作「声明的丢弃」，不能让一个读不到的文件把整轮锚定静默变小。
    try { o = observe(rel, root); }
    catch (e) { unreadable.push({ path: rel, reason: e.code ?? 'READ_FAILED' }); continue; }
    if (!o.properties.exists) { unreadable.push({ path: rel, reason: o.properties.reason ?? 'ENOENT' }); continue; }
    if (typeof o.properties.sha256 !== 'string') { unreadable.push({ path: rel, reason: 'NO_SHA256' }); continue; }
    entries.push({
      path: rel,
      rule: includedBy(rel),
      sha256: o.properties.sha256,
      size_bytes: o.properties.size_bytes
    });
  }
  const excludedSorted = {};
  for (const k of Object.keys(excluded).sort()) excludedSorted[k] = excluded[k];
  const exFiles = Object.values(excludedSorted).reduce((a, b) => a + b.files, 0);
  const exSubtrees = Object.values(excludedSorted).reduce((a, b) => a + b.subtrees, 0);

  return {
    spec: SPEC,
    kind: 'evidence.manifest',
    note: '本文件不声称时间。锚点是本文件自身的 sha256；时间由同名 .ots 提供，由比特币区块头背书。',
    scope: {
      include_rules: INCLUDE_RULES.map(r => r.id),
      exclude_rules: EXCLUDE_RULES.map(r => r.id),
      exclude_wins: true
    },
    counts: {
      entries: entries.length,
      unreadable: unreadable.length,
      excluded_files: exFiles,
      // 子树未展开，所以「被排除的文件总数」本清单**不知道**，也不假装知道。
      excluded_subtrees: exSubtrees
    },
    // 排除项只出计数不出路径：被排除的正是不该公开的客户数据，列名字等于泄露。
    excluded_by_rule: excludedSorted,
    unreadable,
    entries
  };
}

export const serialize = m => JSON.stringify(m, null, 2) + '\n';

// ── OTS：唯一的外部时间来源，缺库/断网时必须显式降级，不许静默跳过 ──────────
async function loadOTS() {
  try { return (await import('javascript-opentimestamps')).default; }
  catch {
    console.error('缺少 javascript-opentimestamps。装它：');
    console.error('  npm install --no-save javascript-opentimestamps@0.4.5');
    console.error('（核心的 build/清单是零依赖的；只有对外盖时间戳这一步需要它）');
    return null;
  }
}

async function cmdBuild() {
  const m = buildManifest();
  fs.writeFileSync(MANIFEST_PATH, serialize(m));
  const self = observe(MANIFEST_PATH, ROOT);
  console.log(`清单已写：governance/anchor-manifest.json`);
  console.log(`  锚定条目 ${m.counts.entries}　读不到 ${m.counts.unreadable}`);
  console.log(`  按策略排除：文件 ${m.counts.excluded_files}　整棵子树 ${m.counts.excluded_subtrees}（子树内文件数未展开，不假装知道）`);
  for (const [rule, n] of Object.entries(m.excluded_by_rule)) console.log(`    排除 ${rule}: 文件 ${n.files} / 子树 ${n.subtrees}`);
  for (const u of m.unreadable) console.log(`    ⚠ 读不到 ${u.path} (${u.reason})`);
  console.log(`  锚点（清单自身 sha256）= ${self.properties.sha256}`);
  console.log(`\n下一步：node governance/anchor.mjs stamp`);
  return 0;
}

/** 列出归档链上的锚点（内容寻址，按名字排序即可稳定枚举）。 */
export function listAnchors() {
  let names;
  try { names = fs.readdirSync(ANCHOR_DIR); } catch { return []; }
  return names.filter(n => n.endsWith('.json')).sort().map(n => ({
    id: n.replace(/\.json$/, ''),
    json: path.join(ANCHOR_DIR, n),
    ots: path.join(ANCHOR_DIR, n + '.ots')
  }));
}

/** 判定单个锚点的外部时间状态。不写盘，只回答「外面怎么说」。 */
async function attestationOf(OTS, a) {
  if (!observe(a.ots, ROOT).properties.exists) return { state: 'unstamped' };
  try {
    const detachedOts = OTS.DetachedTimestampFile.deserialize(fs.readFileSync(a.ots));
    const detachedFile = OTS.DetachedTimestampFile.fromBytes(new OTS.Ops.OpSHA256(), fs.readFileSync(a.json));
    const res = await OTS.verify(detachedOts, detachedFile);
    const btc = res?.bitcoin?.timestamp ?? (typeof res === 'number' ? res : null);
    return btc ? { state: 'bitcoin', at: new Date(btc * 1000).toISOString() } : { state: 'pending' };
  } catch (e) {
    return { state: 'invalid', why: e.message.slice(0, 70) };
  }
}

async function cmdStamp() {
  const OTS = await loadOTS();
  if (!OTS) return 4;
  // 总是从当前磁盘重建，绝不盖一份来路不明的旧清单的章。
  const m = buildManifest();
  const body = serialize(m);
  fs.writeFileSync(MANIFEST_PATH, body);
  const id = observe(MANIFEST_PATH, ROOT).properties.sha256.slice(0, 16);

  fs.mkdirSync(ANCHOR_DIR, { recursive: true });
  const frozen = path.join(ANCHOR_DIR, id + '.json');
  if (observe(frozen, ROOT).properties.exists) {
    console.log(`内容未变，已有同一锚点 ${id}。不重复盖章。`);
    return 0;
  }
  fs.writeFileSync(frozen, body);

  console.log(`冻结快照 governance/anchors/${id}.json（${m.counts.entries} 条证据）`);
  console.log('提交指纹到 OpenTimestamps 日历（只上传 32 字节哈希，不上传任何内容）…');
  const detached = OTS.DetachedTimestampFile.fromBytes(new OTS.Ops.OpSHA256(), Buffer.from(body));
  await OTS.stamp(detached);
  const ctx = new OTS.Context.StreamSerialization();
  detached.serialize(ctx);
  fs.writeFileSync(frozen + '.ots', Buffer.from(ctx.getOutput()));

  console.log(`已写 governance/anchors/${id}.json.ots`);
  console.log('此刻只是「日历承诺」，尚未进比特币区块。等 1~24 小时后跑 upgrade。');
  console.log('把这两个文件提交进 git —— 它们是这批证据的优先权凭证。');
  return 0;
}

async function cmdUpgrade() {
  const OTS = await loadOTS();
  if (!OTS) return 4;
  const anchors = listAnchors();
  if (!anchors.length) { console.error('归档链为空。先跑 stamp。'); return 4; }
  let up = 0, still = 0;
  for (const a of anchors) {
    if (!observe(a.ots, ROOT).properties.exists) continue;
    const detached = OTS.DetachedTimestampFile.deserialize(fs.readFileSync(a.ots));
    let changed = false;
    try { changed = await OTS.upgrade(detached); } catch (e) { console.log(`  ⚠ ${a.id} 升级出错：${e.message.slice(0, 50)}`); continue; }
    if (changed) {
      const ctx = new OTS.Context.StreamSerialization();
      detached.serialize(ctx);
      fs.writeFileSync(a.ots, Buffer.from(ctx.getOutput()));
      up++; console.log(`  ✅ ${a.id} 已拿到比特币区块证明`);
    } else { still++; console.log(`  … ${a.id} 仍待定（正常，过几小时再来）`); }
  }
  console.log(`\n升级 ${up} 个，仍待定 ${still} 个。`);
  return 0;
}

async function cmdVerify() {
  // 第一问：当前磁盘和「刚才重算的清单」一致吗？（build 是确定性的，所以就地重算即可）
  const m = buildManifest();
  fs.writeFileSync(MANIFEST_PATH, serialize(m));
  console.log(`当前磁盘：${m.counts.entries} 条证据在范围内，读不到 ${m.counts.unreadable}`);

  // 第二问：归档链上每个锚点，今天还对得上盘吗？
  // observe 先拿世界，compare 是拿到之后的第二步（本象铁律，不许合成一步）
  const OTS = await loadOTS();
  const anchors = listAnchors();
  if (!anchors.length) {
    console.log('\n归档链为空：**这台机器上没有任何一条时间主张是外部可核的。**');
    console.log('判决：⚠ 不给绿灯（跑 stamp）');
    return 3;
  }

  let external = 0;
  for (const a of anchors) {
    const snap = JSON.parse(fs.readFileSync(a.json, 'utf8'));
    let drifted = 0, gone = 0;
    for (const e of snap.entries) {
      let o;
      try { o = observe(e.path, ROOT); } catch { gone++; continue; }
      const v = compare(o, { sha256: e.sha256, size_bytes: e.size_bytes });
      if (v.verdict === 'gone') gone++;
      else if (v.verdict === 'drifted') drifted++;
    }
    const att = OTS ? await attestationOf(OTS, a) : { state: 'unknown' };
    if (att.state === 'bitcoin' || att.state === 'pending') external++;
    const mark = { bitcoin: '✅ 比特币区块 ' + att.at, pending: '⏳ 日历承诺待定', unstamped: '❌ 未盖章', invalid: '❌ .ots 与快照不匹配：' + att.why, unknown: '? 缺库无法核' }[att.state];
    console.log(`\n锚点 ${a.id}　${snap.entries.length} 条`);
    console.log(`  外部时间锚：${mark}`);
    // 账本是只追加的，改动属预期；消失才是证据出血。两者分开报，别混成一个「差异数」。
    console.log(`  对今日磁盘：一致 ${snap.entries.length - drifted - gone}　已变 ${drifted}（只追加账本会变，正常）　消失 ${gone}`);
    if (gone) console.log(`  ⚠ 有 ${gone} 条证据在盘上消失了——快照仍可证明它们曾存在，但原件已不可复核`);
  }

  console.log(`\n归档链 ${anchors.length} 个锚点，其中 ${external} 个有外部时间锚。`);
  if (!external) { console.log('判决：⚠ 有快照但一个都没盖上章 —— 不给绿灯'); return 3; }
  console.log('判决：✅ 存在外部可核的时间锚');
  return 0;
}

const CMDS = { build: cmdBuild, stamp: cmdStamp, upgrade: cmdUpgrade, verify: cmdVerify };

const invokedDirectly = (() => {
  const a1 = process.argv[1];
  if (!a1) return false;
  try { return import.meta.url === new URL(`file://${path.resolve(a1).replace(/\\/g, '/')}`).href; }
  catch { return false; }
})();
if (invokedDirectly) {
  const cmd = process.argv[2];
  if (!CMDS[cmd]) {
    console.error('用法: node governance/anchor.mjs <build|stamp|upgrade|verify>');
    process.exit(1);
  }
  process.exit(await CMDS[cmd]());
}
