/**
 * corpus.mjs — 章回体语料的唯一分回实现（C 轨）
 *
 * 为什么单独抽出来：分回这件事有第二个消费者了（判词抽取要读第五回，
 * 变点扫描要读全书）。本仓已记录过五次「各部件各写各的观察逻辑」导致的事故
 * （RFC-0006 §0），分回是同一类东西——它是「这本书长什么样」的观察，
 * 不是某个探针的私事。
 *
 * 已知会踩的坑（都来自实测，不是设想）：
 *   - 回次写法不统一：紅樓夢 100 回后用「第一零零回」，西遊記 用「第一○回」，
 *     两者的零还是不同码位（零 / ○）。
 *   - 正文会引用旧回次：「第四回中既將薛家母子…」长得跟回目一模一样。
 *     单调扫描（找第 n 回时只在第 n-1 回之后找）能挡掉。
 *   - 底本会残缺：Gutenberg #24032《儒林外史》缺 16 回、重 1 回。
 *     所以分不出回一律硬抛错，绝不静默跳过——静默跳过会让残书以合法身份进入结论。
 */

const CN = '零一二三四五六七八九十百';
const ZERO = '[零〇○0]';   // 西游记用 ○，红楼梦用 零 —— 底本不同，都得认

export function cnNum(n) {
  if (n < 11) return n === 10 ? '十' : CN[n];
  if (n < 20) return '十' + CN[n - 10];
  const t = Math.floor(n / 10), o = n % 10;
  return CN[t] + '十' + (o ? CN[o] : '');
}

export function cnForms(n) {
  if (n < 10) return [CN[n]];
  const digitwise = String(n).split('').map(d => (d === '0' ? ZERO : CN[Number(d)])).join('');
  if (n < 100) return [cnNum(n), digitwise];   // 第七十一回 / 第七一回
  const r = n % 100;
  const classic = r === 0 ? CN[Math.floor(n / 100)] + '百'
    : r < 10 ? CN[Math.floor(n / 100)] + '百零' + CN[r]
      : CN[Math.floor(n / 100)] + '百' + cnNum(r);
  return [digitwise, classic];
}

/** 剥掉 Gutenberg 头尾声明——那不是作品 */
export function stripGutenberg(raw) {
  const s0 = raw.indexOf('*** START OF THE PROJECT GUTENBERG EBOOK');
  const s1 = raw.indexOf('*** END OF THE PROJECT GUTENBERG EBOOK');
  return raw.slice(s0 >= 0 ? raw.indexOf('\n', s0) + 1 : 0, s1 >= 0 ? s1 : raw.length);
}

export function splitChapters(raw, total = 120) {
  const lines = stripGutenberg(raw).split(/\r?\n/);
  const starts = [];
  let cursor = 0;
  for (let n = 1; n <= total; n++) {
    const pat = new RegExp('^第(' + cnForms(n).join('|') + ')[回囘](?![零一二三四五六七八九十百])');
    let found = -1;
    for (let i = cursor; i < lines.length; i++) {
      if (pat.test(lines[i].trim())) { found = i; break; }
    }
    if (found < 0) throw new Error(`分回失败：找不到第${cnForms(n)[0]}回（第 ${n} 回）——底本可能残缺或回目写法未收录`);
    starts.push(found);
    cursor = found + 1;
  }
  return starts.map((st, i) => {
    const en = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const seg = lines.slice(st, en);
    return { n: i + 1, title: lines[st].trim(), text: seg.join('\n'), body: stripHeading(seg).join('\n') };
  });
}

/**
 * 剥掉回目与导航，只留叙述正文。
 *
 * 为什么必须有这个：回目是**对这一回的内容摘要**，它把事件名逐字写在标题里。
 * 拿回目去证「这件事发生了」，等于拿目录证明正文——与「用第五回判词证明判词兑现」
 * 是同一个病，本仓库已经为后者立过排除规则。
 *
 * 实弹撞上来的：
 *   ① 我方 W4-1 续写有四条判「兑现」，证据全部落在回目行
 *      （「射圃中若蘭喪邊城」「獄神廟茜雪呈正文」「情榜上寶玉證情痴」「因麒麟湘雲歸衛氏」）。
 *      照回目写就能让判分器变绿，而正文里写没写是另一回事。
 *   ② 更要命的是它污染了**已发布的结论**：后四十回那条唯一的「违反」A-15-1，
 *      证据是「賈家延世澤」——全书仅此一处，就在第一一九回的回目行里，
 *      而且那行还带着 wikisource 的导航残渣「上一回　回目录　下一回　----」。
 *      报告里把「违反」称作三态中唯一较难人为制造的一态，而它自己就架在标题上。
 *
 * 剥法：取开头至多 6 行内**最后一个**回次标记行，之后才算正文。
 * 底本里回次标记会出现两次（裸回次行 + 完整回目行），取最后一个两种底本都对。
 */
export function stripHeading(segLines) {
  const MARK = /^第[〇零一二三四五六七八九十百○\d]+[回囘]/;
  let last = -1;
  for (let i = 0; i < Math.min(segLines.length, 6); i++) {
    const t = segLines[i].trim();
    if (MARK.test(t)) last = i;
  }
  return segLines.slice(last + 1);
}

// ── 韵文识别 ──────────────────────────────────────────────────────────────
// 整行由 ≥2 个等长（5 或 7 字）分句组成，且行不长。
// 只认五言/七言；词曲长短句认不出来 —— 已知漏检，宁可少排不可乱排。
// 注意全角空格 U+3000：诗句常用它分句（「無材可去補蒼天　枉入紅塵若許年」），
// 漏掉它整句会被当成一个 15 字分句，五言/七言就认不出来了。
const PUNCT = /[，。！？；：、．「」『』（）《》〈〉“”‘’─．　\.\,\!\?\;\:]/g;

export function isVerseLine(line) {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  const parts = t.split(PUNCT).filter(Boolean);
  if (parts.length < 2) return false;
  const L = parts[0].length;
  if (L !== 5 && L !== 7) return false;
  return parts.every(p => p.length === L);
}

export function verseSplit(text) {
  const verse = [], prose = [];
  for (const l of text.split(/\r?\n/)) (isVerseLine(l) ? verse : prose).push(l);
  return { verse: verse.join('\n'), prose: prose.join('\n') };
}
