#!/usr/bin/env node
/**
 * judge.mjs — 判分器（hongloumeng-c/judge/0.1）
 *
 * 输入：judge-spec.json 的检索谓词 + 指定回次窗口
 * 输出：每条断言 FOUND / NOT_FOUND，FOUND 必附逐字证据（回次 + 原文片段）
 *
 * 它不判「对不对」，只判「文本里有没有」。
 * 「有没有」是可复核的；「对不对」需要解释，那是人的事，不是判分器的事。
 *
 * 用法：
 *   node judge.mjs --from 1 --to 80            # 在前八十回上跑（C0 校准用）
 *   node judge.mjs --from 81 --to 120          # 在后四十回上跑
 *   node judge.mjs --only A-01-1,B-04-1 --json
 * 退出码：0=跑通  1=用法/数据错
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitChapters } from './corpus.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const FROM = Number(flag('--from', 1));
const TO = Number(flag('--to', 120));
const ONLY = flag('--only', null);
const asJson = argv.includes('--json');

const norm = s => String(s).replace(/[\s　]/g, '');

// 只留叙述语，剔除引号内的人物话语。
//
// 为什么必须这样：红楼梦的伏笔在字面上就是人物亲口说出后来会发生的事——
//   第三十回 寶玉道：“你死了，我做和尚！”      （情话，不是出家）
//   第七回   惜春笑道：「我明兒也剃了頭…」      （玩笑，不是出家）
// 人物「说」某事 ≠ 叙述者「叙述」某事发生。不剥引语，判分器会把全书伏笔
// 一律判成已兑现——那样后四十回不写一个字也能拿满分。
// 代价：叙述里引用的对话中若含真实信息会被漏掉（宁可漏判，不可错判）。
function narrationOnly(s) {
  return s
    .replace(/“[^”]*”/g, '　')
    .replace(/「[^」]*」/g, '　')
    .replace(/『[^』]*』/g, '　');
}
const spec = JSON.parse(readFileSync(join(__dir, 'judge-spec.json'), 'utf8'));
const aliasTable = JSON.parse(readFileSync(join(__dir, 'aliases.json'), 'utf8'));
// 语料路径与回数改为可配置：盲测环境要给一份只到第八十回的语料，
// 物理上看不到目标窗口。靠「请你不要看」是自觉，不是隔离。
const CORPUS_PATH = spec.defaults.corpus || 'corpus/wikisource-honglou-120.txt';
const CORPUS_CHAPTERS = spec.defaults.chapters || 120;
const chapters = splitChapters(readFileSync(join(__dir, CORPUS_PATH), 'utf8'), CORPUS_CHAPTERS);

// 主语的全部写法：规范名 + 归一表里的别名。判分器不许自己造别名。
function namesOf(canonical) {
  const out = new Set([norm(canonical)]);
  for (const p of Object.values(aliasTable.persons || {})) {
    if (norm(p.canonical) === norm(canonical)) for (const v of p.variants || []) out.add(norm(v.name));
  }
  return [...out];
}

const EXCLUDE = new Set(spec.defaults.exclude_chapters || []);

// 在一段文本里找「主语附近出现某组谓词」的所有命中
function scan(p, patterns, from, to, useSpeech) {
  const names = p.subject_names ? p.subject_names.map(norm) : namesOf(p.subject);
  const prox = p.proximity ?? spec.defaults.proximity;
  const hits = [];
  for (const c of chapters) {
    if (c.n < from || c.n > to || EXCLUDE.has(c.n)) continue;
    const t = norm(useSpeech ? c.text : narrationOnly(c.text));
    const anchors = [];
    for (const nm of names) { let i = 0; while ((i = t.indexOf(nm, i)) !== -1) { anchors.push([i, nm]); i += nm.length; } }
    if (!anchors.length) continue;
    for (const pat of patterns) {
      let i = 0;
      while ((i = t.indexOf(pat, i)) !== -1) {
        const near = anchors.find(([a]) => Math.abs(a - i) <= prox);
        // 「死」作状语的固定搭配（死保／死守／死活）不是死亡，按声明的排除表剔除
        const adverbial = pat === '死' && (spec.defaults.death_binding?.exclude_after || []).includes(t[i + 1]);
        if (near && !adverbial) {
          const s = Math.max(0, Math.min(near[0], i) - 24), e = Math.min(t.length, Math.max(near[0], i) + 34);
          hits.push({ chapter: c.n, pattern: pat, evidence: t.slice(s, e) });
        }
        i += pat.length;
      }
    }
  }
  const seen = new Set(), uniq = [];
  for (const h of hits) { if (seen.has(h.chapter)) continue; seen.add(h.chapter); uniq.push(h); }
  return uniq;
}

// 某人是否出现在指定的某一回里（用于配置类判据）
function presentIn(chapterNo, who) {
  const c = chapters.find(x => x.n === chapterNo);
  if (!c) return false;
  const t = norm(c.text);
  return namesOf(who).some(nm => t.includes(nm));
}

// ── 带量判据 ──────────────────────────────────────────────────────────────
// 判词里最硬的断言都是带量的。只判「有没有写」判不出「怎么兑现的」：
//   配置 —— 脂批说宝玉出家时「寶釵之妻、麝月之婢」，妻与婢是两个具名槽位
//   次序 —— 判词说「爵祿高登」之后「黃泉路近」，两件事被绑成先后
// 把它们降维成「有没有写宝玉出家」「有没有写贾兰中举」，等于把断言判宽了一大截。
function runQuantified(p, from, to) {
  if (p.kind === 'configuration') {
    const anchor = scan({ subject: p.anchor.subject, proximity: p.anchor.proximity }, p.anchor.any_of, from, to, false);
    if (!anchor.length) {
      return { id: p.id, claim: p.claim, subject: p.subject, verdict: 'NOT_FOUND', chapters: [], evidence: [], against_chapters: [], against_evidence: [], spoken_only: [], slots: [] };
    }
    const at = anchor[0].chapter;
    const slots = p.require_present.map(who => ({ who, present: presentIn(at, who) }));
    const missing = slots.filter(s => !s.present);
    return {
      id: p.id, claim: p.claim, subject: p.subject,
      verdict: missing.length ? 'NOT_FOUND' : 'FULFILLED',
      chapters: [at], evidence: anchor.slice(0, 1),
      against_chapters: [], against_evidence: [], spoken_only: [],
      slots, anchor_chapter: at,
      detail: missing.length ? `锚点在第 ${at} 回；到场 ${slots.filter(s => s.present).map(s => s.who).join('、') || '无'}；缺席 ${missing.map(s => s.who).join('、')}` : `锚点在第 ${at} 回；${slots.map(s => s.who).join('、')} 全部在场`,
    };
  }
  // order
  const a = scan({ subject: p.first.subject, proximity: p.first.proximity }, p.first.any_of, from, to, false);
  const b = scan({ subject: p.then.subject, proximity: p.then.proximity }, p.then.any_of, from, to, false);
  let verdict = 'NOT_FOUND', detail;
  if (!a.length) detail = '前一事件未检出，先后无从判起';
  else if (!b.length) detail = `前一事件在第 ${a[0].chapter} 回，后一事件未检出 —— 未交代，不得默认为满足`;
  else if (b[0].chapter >= a[0].chapter) { verdict = 'FULFILLED'; detail = `第 ${a[0].chapter} 回 → 第 ${b[0].chapter} 回，先后成立`; }
  else { verdict = 'CONTRADICTED'; detail = `后一事件在第 ${b[0].chapter} 回，早于前一事件第 ${a[0].chapter} 回 —— 次序与判词相反`; }
  return {
    id: p.id, claim: p.claim, subject: p.subject, verdict,
    chapters: b.map(h => h.chapter).slice(0, 4), evidence: b.slice(0, 1),
    against_chapters: verdict === 'CONTRADICTED' ? [b[0].chapter] : [], against_evidence: [],
    spoken_only: [], first_chapter: a[0]?.chapter ?? null, detail,
  };
}

export function runOne(p, from = FROM, to = TO) {
  if (p.kind === 'configuration' || p.kind === 'order') return runQuantified(p, from, to);
  const names = p.subject_names ? p.subject_names.map(norm) : namesOf(p.subject);
  const prox = p.proximity ?? spec.defaults.proximity;
  const hits = [];
  for (const c of chapters) {
    if (c.n < from || c.n > to || EXCLUDE.has(c.n)) continue;
    const t = norm(p.kind === 'status' ? c.text : narrationOnly(c.text));
    // 主语出现的所有位置
    const anchors = [];
    for (const nm of names) { let i = 0; while ((i = t.indexOf(nm, i)) !== -1) { anchors.push([i, nm]); i += nm.length; } }
    if (!anchors.length) continue;
    for (const pat of p.any_of) {
      let i = 0;
      while ((i = t.indexOf(pat, i)) !== -1) {
        const near = anchors.find(([a]) => Math.abs(a - i) <= prox);
        if (near) {
          // 附加条件：另一批名字也要在更大范围内出现（如「宝玉与宝钗成婚」需两人同现）
          let okExtra = true;
          if (p.also_requires) {
            const extra = p.also_requires.names.flatMap(namesOf);
            const ep = p.also_requires.proximity ?? prox;
            okExtra = extra.some(nm => { let j = 0; while ((j = t.indexOf(nm, j)) !== -1) { if (Math.abs(j - i) <= ep) return true; j += nm.length; } return false; });
          }
          const adverbial2 = pat === '死' && (spec.defaults.death_binding?.exclude_after || []).includes(t[i + 1]);
          if (okExtra && !adverbial2) {
            const s = Math.max(0, Math.min(near[0], i) - 24), e = Math.min(t.length, Math.max(near[0], i) + 34);
            hits.push({ chapter: c.n, pattern: pat, anchor: near[1], evidence: t.slice(s, e) });
          }
        }
        i += pat.length;
      }
    }
  }
  // 每回只留第一条证据，避免同一处反复计数
  const seen = new Set(), uniq = [];
  for (const h of hits) { if (seen.has(h.chapter)) continue; seen.add(h.chapter); uniq.push(h); }

  // 三态：兑现 / 违反 / 未交代。
  // 两态判分器会把「写了相反的」报成「没写」，而这两者对被判对象的意义完全不同。
  const useSpeech = p.kind === 'status';
  const against = p.contradicts ? scan(p, p.contradicts, from, to, useSpeech) : [];
  let verdict = 'NOT_FOUND';
  if (uniq.length && against.length) verdict = 'BOTH';
  else if (against.length) verdict = 'CONTRADICTED';
  else if (uniq.length) verdict = 'FULFILLED';

  // 人物话语里的命中单独报告，标明不计入判决——不藏，也不采信
  const spoken = (!useSpeech && p.contradicts)
    ? scan(p, p.contradicts, from, to, true).filter(h => !against.some(a => a.chapter === h.chapter))
    : [];

  // 叙述语里找不到、但人物话语里有 —— 这一类必须单独报出来。
  //
  // 实测的那个例子：迎春之死在全书正文里只出现于
  //   「豈知那婆子剛到邢夫人那里，外頭的人已傳進來說：『二姑奶奶死了。』」
  // 死讯在引号内，且用的称呼是「二姑奶奶」。按规则它不计入兑现，
  // 但把它报成一个干巴巴的「未交代」是失真的——文本确实交代了，只是以转述形式。
  // 于是：判决仍按规则给 NOT_FOUND，同时挂上「仅见于转述」的证据，让读的人自己看。
  const spokenFulfill = (!useSpeech && !uniq.length)
    ? scan(p, p.any_of, from, to, true)
    : [];

  return {
    id: p.id, claim: p.claim, subject: p.subject, verdict,
    chapters: uniq.map(h => h.chapter), evidence: uniq.slice(0, 4),
    against_chapters: against.map(h => h.chapter), against_evidence: against.slice(0, 3),
    spoken_only: spoken.slice(0, 3),
    spoken_fulfill: spokenFulfill.slice(0, 3),
  };
}

const only = ONLY ? new Set(ONLY.split(',').map(s => s.trim())) : null;
const preds = spec.predicates.filter(p => !only || only.has(p.id));
const results = preds.map(p => runOne(p));

if (asJson) { console.log(JSON.stringify({ window: [FROM, TO], excluded: [...EXCLUDE], results }, null, 2)); process.exit(0); }

console.log(`═══ 判分器 · 第 ${FROM}–${TO} 回（排除第 ${[...EXCLUDE].join('、')} 回：判词所在）═══
`);
const MARK = { FULFILLED: '● 兑现  ', CONTRADICTED: '✖ 违反  ', BOTH: '⚠ 两者皆有', NOT_FOUND: '○ 未交代' };
for (const r of results) {
  console.log(`${MARK[r.verdict]} ${r.id.padEnd(8)} ${r.claim}`);
  if (r.chapters.length) {
    console.log(`    兑现证据 第 ${r.chapters.slice(0, 6).join('、')} 回`);
    for (const e of r.evidence.slice(0, 1)) console.log(`      「${e.pattern}」┊ …${e.evidence}…`);
  }
  if (r.against_chapters.length) {
    console.log(`    违反证据 第 ${r.against_chapters.slice(0, 6).join('、')} 回`);
    for (const e of r.against_evidence.slice(0, 2)) console.log(`      「${e.pattern}」┊ …${e.evidence}…`);
  }
  if (r.spoken_fulfill && r.spoken_fulfill.length) {
    console.log(`    ⚠ 叙述语中未见，但第 ${r.spoken_fulfill.map(e => e.chapter).join('、')} 回的人物话语中有 —— 按规则不计入兑现，单列供复核`);
    for (const e of r.spoken_fulfill.slice(0, 1)) console.log(`      第${e.chapter}回「${e.pattern}」┊ …${e.evidence}…`);
  }
  if (r.spoken_only.length) {
    console.log(`    （补充：另有 ${r.spoken_only.length} 处反向线索出自人物话语，不计入判决）`);
    for (const e of r.spoken_only.slice(0, 1)) console.log(`      第${e.chapter}回「${e.pattern}」┊ …${e.evidence}…`);
  }
  if (r.detail) console.log(`    ${r.detail}`);
  if (r.slots) for (const sl of r.slots) console.log(`      ${sl.present ? '✓ 在场' : '✗ 缺席'}  ${sl.who}`);
  if (!r.chapters.length && !r.against_chapters.length && !r.detail) console.log('    未检出');
}
const n = v => results.filter(r => r.verdict === v).length;
console.log(`
兑现 ${n('FULFILLED')}　违反 ${n('CONTRADICTED')}　两者皆有 ${n('BOTH')}　未交代 ${n('NOT_FOUND')}　共 ${results.length}`);
