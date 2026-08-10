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
import { createMatcher } from './matcher.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const FROM = Number(flag('--from', 1));
const TO = Number(flag('--to', 120));
const ONLY = flag('--only', null);
const asJson = argv.includes('--json');

const spec = JSON.parse(readFileSync(join(__dir, 'judge-spec.json'), 'utf8'));
const aliasTable = JSON.parse(readFileSync(join(__dir, 'aliases.json'), 'utf8'));
// 语料路径与回数改为可配置：盲测环境要给一份只到第八十回的语料，
// 物理上看不到目标窗口。靠「请你不要看」是自觉，不是隔离。
const CORPUS_PATH = spec.defaults.corpus || 'corpus/wikisource-honglou-120.txt';
const CORPUS_CHAPTERS = spec.defaults.chapters || 120;
const chapters = splitChapters(readFileSync(join(__dir, CORPUS_PATH), 'utf8'), CORPUS_CHAPTERS);

const EXCLUDE = new Set(spec.defaults.exclude_chapters || []);

// 匹配语义只有一份，在 matcher.mjs。本文件只负责：读谓词、定窗口、把命中拼成三态判决。
// 此前 scan 与 runOne 各写了一遍字符级匹配（一个有 also_requires 一个没有），
// 而外部入口又写了第三遍——同一类错误犯了三次。见 matcher.mjs 头部。
const { norm, narrationOnly, namesOf, scan, paraHits, presentIn, pickEvidence } =
  createMatcher({ spec, aliasTable, chapters, exclude: EXCLUDE });

// ── 带量判据 ──────────────────────────────────────────────────────────────
// 判词里最硬的断言都是带量的。只判「有没有写」判不出「怎么兑现的」：
//   配置 —— 脂批说宝玉出家时「寶釵之妻、麝月之婢」，妻与婢是两个具名槽位
//   次序 —— 判词说「爵祿高登」之后「黃泉路近」，两件事被绑成先后
// 把它们降维成「有没有写宝玉出家」「有没有写贾兰中举」，等于把断言判宽了一大截。
function runQuantified(p, from, to) {
  if (p.kind === 'configuration') {
    const anchor = scan({ subject: p.anchor.subject, proximity: p.anchor.proximity }, p.anchor.any_of, from, to, false);
    if (!anchor.length) {
      // 锚点没解析出来 → 槽位代码根本没跑。必须如实记下，否则「闸门全绿」会掩盖「半截没测」。
      return { id: p.id, claim: p.claim, subject: p.subject, verdict: 'NOT_FOUND', chapters: [], evidence: [], against_chapters: [], against_evidence: [], spoken_only: [], slots: [],
        legs_executed: { anchor: false, slots: 0, of: (p.require_present||[]).length } };
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
      legs_executed: { anchor: true, slots: slots.length, of: (p.require_present||[]).length },
      detail: missing.length ? `锚点在第 ${at} 回；到场 ${slots.filter(s => s.present).map(s => s.who).join('、') || '无'}；缺席 ${missing.map(s => s.who).join('、')}` : `锚点在第 ${at} 回；${slots.map(s => s.who).join('、')} 全部在场`,
    };
  }
  // order
  //
  // subject_names 必须透传。此前这里只传 subject，谓词自己声明的别名表被静默丢弃——
  // C-ORDER 的 first 声明了 subject_names:["秦可卿","秦氏"]，而第十三回叙述里写的是
  // 「聽見說秦氏死了」，正文永远匹配不上。它一直判绿，靠的是回目「秦可卿死封龍禁尉」
  // 里 subject 与谓词恰好挨着。把回目排除掉的那一刻这条腿就红了，
  // 也就是说：这个**专门用来证明「次序类的两条腿真的各跑过一次」的对照谓词**，
  // 两条腿从来没在正文里跑过。恒绿考题的又一种形态，且它伪装成的正是「反恒绿的那个装置」。
  const a = scan({ subject: p.first.subject, subject_names: p.first.subject_names, proximity: p.first.proximity }, p.first.any_of, from, to, false);
  const b = scan({ subject: p.then.subject, subject_names: p.then.subject_names, proximity: p.then.proximity }, p.then.any_of, from, to, false);
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
    legs_executed: { first: a.length > 0, then: b.length > 0 },
  };
}

export function runOne(p, from = FROM, to = TO) {
  if (p.kind === 'configuration' || p.kind === 'order') return runQuantified(p, from, to);
  if (p.anchor_scope === 'paragraph') {
    const uniq = paraHits(p, p.any_of, from, to, p.kind === 'status');
    const against = p.contradicts ? paraHits(p, p.contradicts, from, to, p.kind === 'status') : [];
    const verdict = uniq.length && against.length ? 'BOTH' : against.length ? 'CONTRADICTED' : uniq.length ? 'FULFILLED' : 'NOT_FOUND';
    return { id: p.id, claim: p.claim, subject: p.subject, verdict,
      chapters: uniq.map(h => h.chapter), evidence: pickEvidence(uniq),
      against_chapters: against.map(h => h.chapter), against_evidence: against.slice(0, 3),
      spoken_only: [], spoken_fulfill: [] };
  }
  // 这里曾经把 scan 的逻辑又抄了一遍——多了 also_requires，少了别的。
  // 同一个文件里两条匹配路径，一样会漂。现在只调用唯一实现。
  const useSpeechMain = p.kind === 'status';
  const uniq = scan(p, p.any_of, from, to, useSpeechMain);

  // 三态：兑现 / 违反 / 未交代。
  // 两态判分器会把「写了相反的」报成「没写」，而这两者对被判对象的意义完全不同。
  const useSpeech = useSpeechMain;
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

  // 近失探针：字符级锚定找不到时，再用段级锚定跑一遍。
  //
  // 起因是外部对抗性复核抓到的 A-09-2a：它挂着合法 recall_control、C0 全绿，
  // 判决却是错的——原文第一〇九回明写「不料被孫家揉搓以致身亡」，
  // 而整句无主语名（「一位如花似月之女」），最近一处「迎春」在 320 字外。
  //
  // 放宽锚定已被 C0 否决（对高频词太松），所以不改判决，只让漏判现形：
  // 段级找得到而字符级找不到 = 疑似锚定漏判，报告里必须单列。
  // 这样「我没找到」与「文本没写」在报告上就分得开了。
  const nearMiss = (!uniq.length && p.anchor_scope !== 'paragraph')
    ? paraHits(p, p.any_of, from, to, useSpeech)
    : [];

  return {
    id: p.id, claim: p.claim, subject: p.subject, verdict,
    chapters: uniq.map(h => h.chapter), evidence: pickEvidence(uniq),
    against_chapters: against.map(h => h.chapter), against_evidence: against.slice(0, 3),
    spoken_only: spoken.slice(0, 3),
    spoken_fulfill: spokenFulfill.slice(0, 3),
    near_miss: nearMiss.slice(0, 3),
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
  if (r.near_miss && r.near_miss.length) {
    console.log('    ⛳ 近失：段级锚定在第 '+r.near_miss.map(e=>e.chapter).join('、')+' 回找得到，字符级够不着 —— 疑似锚定漏判，不改判决');
    for (const e of r.near_miss.slice(0,1)) console.log('      第'+e.chapter+'回「'+e.pattern+'」┊ …'+e.evidence+'…');
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

// ── 近失探针（near-miss probe）──────────────────────────────────────────
//
// 起因：外部对抗性复核抓到 A-09-2a —— 它挂着合法的 recall_control、C0 全绿，
// 判决却是错的。原文第一〇九回明写「不料被孫家揉搓以致身亡」，而谓词
// 因为整句无主语名（「一位如花似月之女」）、最近一处「迎春」在 320 字外而漏掉。
//
// C0.6 查的是「同类事件找不找得到」，查不出「这一条的锚定够不够得着」。
// 补丁式放宽锚定已被 C0 否决（对高频词太松）。所以换个方向：
// 不放宽判决，而是让漏判**现形**——
//   对每条「未交代」，再用段级锚定跑一遍；
//   段级找得到而字符级找不到 = 疑似锚定漏判，报告里必须单列。
//
// 它不改变任何判决，只把「我没找到」和「文本没写」在报告里分开。
export function nearMiss(p, from, to) {
  if (p.kind === 'configuration' || p.kind === 'order') return [];
  const pats = p.any_of || [];
  if (!pats.length) return [];
  const wide = paraHits({ ...p, anchor_scope: 'paragraph' }, pats, from, to, p.kind === 'status');
  return wide;
}
