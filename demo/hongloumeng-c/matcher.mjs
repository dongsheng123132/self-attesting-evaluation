/**
 * matcher.mjs — 判分器的唯一匹配实现（hongloumeng-c/matcher/0.1）
 *
 * 为什么必须只有一份：
 *   本轨此前有两个入口——judge.mjs 判曹雪芹与后四十回，judge-external.mjs 判外部续写。
 *   两份匹配代码，同一类错误犯了三次，每一次都让「跨文本判决可比」这个前提当场失效：
 *
 *   ① judge-external 漏实现 also_requires
 *      → A-04-1「宝玉与宝钗成婚」命中第一二三回「外洋某国国王迎娶的是中原贾府三小姐」。
 *        那是探春。
 *   ② judge-external 漏实现 no_clause_boundary（死亡类不得跨句读绑定主语）
 *      → 「後來金桂死了，香菱本以为苦日子到头了」判成香菱死；
 *        「贾珠…却一病死了。李纨守了這些年寡」判成李纨死。
 *   ③ judge.mjs 自己的 runOne 又把 scan 的逻辑抄了一遍（多了 also_requires、少了别的），
 *      于是同一个文件里两条路径也开始漂移。
 *
 *   这三次都不是「粗心」——**只要匹配语义有两份，它们就会漂**。
 *   这与本仓库 RFC-0006 §0 记的那条同源：观察逻辑各写各的，是「自证」复发五次的结构性原因。
 *
 * 繁简怎么处理：
 *   外部续编是简体，判据与语料是繁体。此前的做法是为外部单开一个入口做归一，
 *   理由正当（把归一塞进主线会改变前八十回的匹配，等于为了判别人动了校准基线），
 *   但代价是复制了整套匹配逻辑。
 *   现在归一降级成本模块的一个参数 `transform`：主线传恒等函数，外部传繁简映射。
 *   **判决语义只有一份，字符归一是它的输入**——而不是反过来。
 */

export function createMatcher({ spec, aliasTable, chapters, transform = s => s, exclude = new Set() }) {
  const norm = s => String(s).replace(/[\s　]/g, '');
  const T = s => transform(norm(s));

  // 分句边界：死亡类谓词不得跨句读绑定主语（判据见 judge-spec 的 death_binding.clause_why）
  const CLAUSE = /[。，；！？、：]/;
  const DB = spec.defaults.death_binding || {};
  const SPLIT_NL = /\r?\n/;

  // 只留叙述语，剔除引号内的人物话语。
  // 红楼梦的伏笔在字面上就是人物亲口说出后来会发生的事（第三十回宝玉「你死了，我做和尚」），
  // 不剥引语，后四十回不写一个字也能拿满分。
  const narrationOnly = s => String(s)
    .replace(/“[^”]*”/g, '　').replace(/「[^」]*」/g, '　')
    .replace(/『[^』]*』/g, '　').replace(/"[^"]*"/g, '　');

  function namesOf(canonical) {
    const out = new Set([norm(canonical)]);
    for (const p of Object.values(aliasTable.persons || {})) {
      if (norm(p.canonical) === norm(canonical)) for (const v of p.variants || []) out.add(norm(v.name));
    }
    return [...out].map(transform);
  }
  const namesFor = p => (p.subject_names ? p.subject_names.map(T) : namesOf(p.subject));

  // 「死」落在成语内部不算死亡（死去活來／該死／要死…）
  function inExcludedPhrase(t, i, pat) {
    for (const ph of (DB.exclude_phrases || []).map(T)) {
      const off = ph.indexOf(pat);
      if (off >= 0 && t.slice(i - off, i - off + ph.length) === ph) return true;
    }
    return false;
  }
  function isAdverbial(p, t, i, pat) {
    if (pat !== T('死')) return false;
    return (DB.exclude_after || []).map(transform).includes(t[i + 1])
      || (p.death_binding && inExcludedPhrase(t, i, pat));
  }

  const chapterText = (c, useSpeech) => T(useSpeech ? c.body : narrationOnly(c.body));
  const inWindow = (c, from, to) => !(c.n < from || c.n > to || exclude.has(c.n));

  /**
   * 段级锚定：中文叙事靠话题延续，一段之内不重复主语名。
   * 第一〇九回「可怜一位如花似月之女…不料被孫家揉搓以致身亡」整句无「迎春」二字，
   * 最近一处在 320 字外，任何字符邻近阈值都够不着。
   * 但段落最长 1623 字，全段绑定必然误报，所以只按谓词声明启用，由 C0 裁决。
   */
  function paraHits(p, patterns, from, to, useSpeech) {
    const names = namesFor(p);
    const pats = patterns.map(T);
    const hits = [];
    for (const c of chapters) {
      if (!inWindow(c, from, to)) continue;
      for (const raw of (useSpeech ? c.body : narrationOnly(c.body)).split(SPLIT_NL)) {
        const t = T(raw);
        if (!t || !names.some(nm => t.includes(nm))) continue;
        for (const pat of pats) {
          const i = t.indexOf(pat);
          if (i < 0) continue;
          if (pat === T('死') && (DB.exclude_after || []).map(transform).includes(t[i + 1])) continue;
          hits.push({ chapter: c.n, pattern: pat, evidence: t.slice(Math.max(0, i - 40), i + 30) });
          break;
        }
      }
    }
    return dedupeByChapter(hits);
  }

  /**
   * 字符级锚定：主语名附近出现谓词。
   * 四条约束缺一不可，缺哪条就会长出上面注释里那些误判：
   *   proximity      —— 贴身绑定
   *   death_binding  —— 不得跨句读
   *   also_requires  —— 另一批名字须在更大范围内同现
   *   exclude_*      —— 状语与成语不是死亡
   */
  function scan(p, patterns, from, to, useSpeech) {
    if (p.anchor_scope === 'paragraph') return paraHits(p, patterns, from, to, useSpeech);
    const names = namesFor(p);
    const prox = p.proximity ?? spec.defaults.proximity;
    const pats = patterns.map(T);
    const dbClause = p.death_binding && DB.no_clause_boundary;
    const hits = [];
    for (const c of chapters) {
      if (!inWindow(c, from, to)) continue;
      const t = chapterText(c, useSpeech);
      const anchors = [];
      for (const nm of names) { let i = 0; while ((i = t.indexOf(nm, i)) !== -1) { anchors.push([i, nm]); i += nm.length; } }
      if (!anchors.length) continue;
      for (const pat of pats) {
        let i = 0;
        while ((i = t.indexOf(pat, i)) !== -1) {
          const near = anchors.find(([a]) => Math.abs(a - i) <= prox
            && (!dbClause || !CLAUSE.test(t.slice(Math.min(a, i), Math.max(a, i)))));
          if (near && !isAdverbial(p, t, i, pat) && extraOk(p, t, i, prox)) {
            const s = Math.max(0, Math.min(near[0], i) - 24), e = Math.min(t.length, Math.max(near[0], i) + 34);
            const h = { chapter: c.n, pattern: pat, anchor: near[1], evidence: t.slice(s, e) };
            const cav = irrealisCaveat(t, i);
            if (cav) h.caveat = cav;
            hits.push(h);
          }
          i += pat.length;
        }
      }
    }
    return dedupeByChapter(hits);
  }

  /**
   * 未然/转述语境的**披露**（不是拦截）。
   *
   * 起因是 W3-2 把假绿抽查扩到后四十回全量：17 条兑现里 5 条的引用证据不成立，
   * 而且是同一族——文本里有那个词，但那句话说的不是这件事：
   *   A-04-1 宝玉宝钗成婚 ← 第89回「黛玉日間聽見的話，都似寶玉娶親的話」（传闻，且此时未婚）
   *   A-08-1 妙玉陷污浊   ← 第87回「妙玉恐有賊來」（担心）
   *   A-10-1 惜春出家     ← 第112回「便要把自己的青絲絞去，要想出家」（动念）
   *   B-04-1 宝玉为僧     ← 第119回「追想當年…若慪急了他，便賭誓說做和尚」（回忆旧誓）
   * 判分器有「不认人物话语」的规则，却没有任何规则挡「未然/传闻/回忆」——
   * 而叙述语里这类语气极多。
   *
   * 为什么只披露不拦截：这四条的**判决**多半仍是对的，正确证据另在别处
   * （A-04-1 在第98回「正是寶玉娶寶釵的這個時辰」，A-08-1 在第112回「被這強盜的悶香熏住」）。
   * 但 B-04-1 是个反例：后四十回确实写了宝玉出家，而叙述语里**找不到**更好的证据。
   * 硬删这一族就是拿假绿换假红——把一个「证据引错」换成一个「文本没写」的错误结论。
   * 所以这里只给证据打标，判决一个字不动，让读的人自己回原文。
   *
   * 标记表按短语列举，每条都能指出对应的误报现场；表可增可驳。
   * 「聽見說」不在表内：C0 正例 A-14-3 的证据正是第十三回「從夢中聽見說秦氏死了」，
   * 那是转述形式的真事件——转述本身不等于未然。
   */
  const IRREALIS = [
    { m: '似', why: '比拟/传闻：「都似寶玉娶親的話」' },
    { m: '象', why: '比拟：「也象寶玉娶親的光景」' },
    { m: '恐', why: '担心未发生：「妙玉恐有賊來」' },
    { m: '只怕', why: '担心未发生' },
    { m: '要想', why: '动念未行：「要想出家」' },
    { m: '便要', why: '动念未行：「便要把自己的青絲絞去」' },
    { m: '賭誓說', why: '回忆旧誓：「便賭誓說做和尚」' },
    { m: '追想當年', why: '回忆：「追想當年寶玉相待的情分」' },
  ];
  function irrealisCaveat(t, i) {
    const win = t.slice(Math.max(0, i - 16), i);
    const hit = IRREALIS.find(x => win.includes(transform(x.m)));
    return hit ? { marker: hit.m, why: hit.why } : null;
  }

  function extraOk(p, t, i, prox) {
    if (!p.also_requires) return true;
    const extra = p.also_requires.names.flatMap(namesOf);
    const ep = p.also_requires.proximity ?? prox;
    return extra.some(nm => { let j = 0; while ((j = t.indexOf(nm, j)) !== -1) { if (Math.abs(j - i) <= ep) return true; j += nm.length; } return false; });
  }

  // 每回只留第一条证据，避免同一处反复计数
  function dedupeByChapter(hits) {
    const seen = new Set(), uniq = [];
    for (const h of hits) { if (seen.has(h.chapter)) continue; seen.add(h.chapter); uniq.push(h); }
    return uniq;
  }

  function presentIn(chapterNo, who) {
    const c = chapters.find(x => x.n === chapterNo);
    if (!c) return false;
    const t = T(c.body);
    return namesOf(who).some(nm => t.includes(nm));
  }

  // 选哪几条命中当「证据」展示：不带未然标记的优先。
  // **只动展示次序，不动 chapters 与判决**——order 类谓词靠 chapters[0] 定先后，
  // 在那里排序会把「先后成立」判反。这是本仓库反复记的那条：
  // 为了显示好看去改数据结构，改的往往正是别人拿来算的那个字段。
  const pickEvidence = (hits, n = 4) =>
    [...hits.filter(h => !h.caveat), ...hits.filter(h => h.caveat)].slice(0, n);

  return { norm, narrationOnly, namesOf, scan, paraHits, presentIn, dedupeByChapter, pickEvidence, CLAUSE };
}
