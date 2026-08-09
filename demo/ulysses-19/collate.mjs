#!/usr/bin/env node
// 底本判别器：判定一份 Ulysses 电子文本携带的是 1922 初版读法还是后世校订读法。
//
// 为什么需要它：Gutenberg #4300 的文件头不声明底本。若拿它当「原著」给验证器定 C0 基线，
// 基线会错得完全看不出来——所有下游验证器会一起给出自信的绿。
//
// 判据形式：每条 discriminator 给出一处「两版读法不同」的锚点。
//   gabler_only  = 该字符串只应出现在后世校订本（罗森巴赫手稿恢复段等）
//   both         = 两版都有，用于确认锚点定位没跑偏（防止「整篇没匹配上」被误读成「干净」）
//
// 用法：
//   node demo/ulysses-19/collate.mjs                     # 判别 corpus 下两份文本
//   node demo/ulysses-19/collate.mjs <file> [...]        # 判别指定文本
// 退出码：0 = 全部被判为 1922 读法   2 = 至少一份携带校订读法   1 = 用法/文件错误

import fs from 'node:fs';
import path from 'node:path';
import { observeText, locate } from '../../benxiang/observe-text.mjs';

const DISCRIMINATORS = [
  {
    id: 'D1',
    kind: 'gabler_only',
    // 《斯库拉与卡律布狄斯》：Gabler 1984 据罗森巴赫手稿恢复的一段。
    // 1922 初版此处由 "L'art d'être grand..." 直接接 "His own image to a man..."。
    probe: /Love,\s*yes\.\s*Word known to all men/i,
    note: 'Scylla & Charybdis：Gabler 恢复段（Love, yes. Word known to all men.）'
  },
  {
    id: 'D2',
    kind: 'gabler_only',
    probe: /Amor vero aliquid alicui bonum vult/i,
    note: 'Scylla & Charybdis：紧随 D1 的阿奎那拉丁引文，同属该恢复段'
  },
  {
    id: 'D3',
    kind: 'gabler_only',
    probe: /Will he not see reborn in her, with the memory of his own youth added/i,
    note: 'Scylla & Charybdis：该恢复段的引入句'
  },
  {
    id: 'A1',
    kind: 'both',
    // OCR 会把 être 认成 étre，故只锚定稳定前缀。
    probe: /art of being a grandfather/i,
    note: '定位锚点：两版皆有。若此条 miss，说明文本未覆盖该段落，判别结果不作数'
  },
  {
    id: 'A2',
    kind: 'both',
    probe: /What is that word known to all men\?/i,
    note: '定位锚点：Proteus 中的同名短语，两版皆有——用于区分「整本没有这个短语」与「只是没有恢复段」'
  }
];

function classify(file) {
  // 两份文本的折行位置不同（Gutenberg 在 "all men" 中间断行，OCR 按扫描行断）。
  // 不规范化空白，探针会因为一个换行而漏报——D1 第一版就是这么假阴性的。
  // 规范化不再在这里自己写：这个职责已收进本象（benxiang/observe-text.mjs），
  // 因为同一个病在本会话里被独立犯了两次。
  const obs = observeText(fs.readFileSync(file, 'utf8'));
  const hits = DISCRIMINATORS.map(d => ({ ...d, hit: locate(obs, d.probe).length > 0 }));

  const anchors = hits.filter(h => h.kind === 'both');
  const anchorsOk = anchors.every(a => a.hit);
  const gabler = hits.filter(h => h.kind === 'gabler_only' && h.hit);

  let verdict;
  if (!anchorsOk) verdict = 'INCONCLUSIVE';
  else if (gabler.length > 0) verdict = 'POST-1922-EDITED';
  else verdict = 'CONSISTENT-WITH-1922';

  return { file, verdict, anchorsOk, hits, gablerCount: gabler.length };
}

const args = process.argv.slice(2);
const targets = args.length
  ? args
  : ['pg4300-ulysses-1922.txt', 'archive-1922-shakespeare-ocr.txt']
      .map(f => path.join('demo/ulysses-19/corpus', f));

let dirty = false;
for (const t of targets) {
  if (!fs.existsSync(t)) {
    console.error(`缺文件: ${t}`);
    process.exit(1);
  }
  const r = classify(t);
  console.log(`\n═══ ${r.file}`);
  for (const h of r.hits) {
    const mark = h.hit ? '●' : '○';
    console.log(`  ${mark} ${h.id} [${h.kind}] ${h.note}`);
  }
  console.log(`  判决: ${r.verdict}` + (r.verdict === 'POST-1922-EDITED' ? `（命中 ${r.gablerCount} 条校订读法）` : ''));
  if (r.verdict !== 'CONSISTENT-WITH-1922') dirty = true;
}

console.log(dirty
  ? '\n⛔ 至少一份文本携带后世校订读法或判别不确定——不得用作 C0 基线。'
  : '\n✅ 全部文本与 1922 初版读法一致。');
process.exit(dirty ? 2 : 0);
