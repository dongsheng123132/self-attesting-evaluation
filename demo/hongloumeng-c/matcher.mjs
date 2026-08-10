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
            hits.push({ chapter: c.n, pattern: pat, anchor: near[1], evidence: t.slice(s, e) });
          }
          i += pat.length;
        }
      }
    }
    return dedupeByChapter(hits);
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

  return { norm, narrationOnly, namesOf, scan, paraHits, presentIn, dedupeByChapter, CLAUSE };
}
