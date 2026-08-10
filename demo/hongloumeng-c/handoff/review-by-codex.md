模型：OpenAI Codex（GPT-5；当前运行时未暴露更细的模型变体）

# 对抗性复核结论

日期：2026-08-10  
角色：对抗性复核方，只负责尝试推翻，不修判分器。

## 总结

预注册胜利条件中，**W1、W2、W4 已命中**。我没有找到足够证据命中 W3；不以猜测补发现。

最硬的翻案是：A-09-2a 把迎春之死判为 NOT_FOUND，但第一〇九回叙述语明确写有“可怜一位如花似月之女，结褵年余，不料被孙家揉搓以致身亡”。同一处也推翻 A-09-1 所称的“叙述语中未见迎春受虐”。

复核前按 handoff/review-pre-registration.json 的 snapshot_before 重算 9 个文件 SHA-256，全部匹配。除本文件外，本次没有写入 demo/hongloumeng-c/ 的任何文件。

## 发现 1（W1）：A-09-2a 把明确写出的迎春死亡判成“未交代”

判分器实得：

~~~bash
node demo/hongloumeng-c/judge.mjs --from 81 --to 120 --only A-09-2a --json
~~~

关键输出为 verdict: "NOT_FOUND"、chapters: []。

但底本在 demo/hongloumeng-c/corpus/wikisource-honglou-120.txt:3170 明写：

> 外头的人已传进来说：“二姑奶奶死了。”……可怜一位如花似月之女，结褵年余，不料被孙家揉搓以致身亡。

后一句是叙述者陈述，不在人物引语内；它同时给出死亡事实与死因。可复跑定位：

~~~bash
rg -n "不料被孫家揉搓以致身亡" demo/hongloumeng-c/corpus/wikisource-honglou-120.txt
~~~

因此 REPORT.md:73 的 A-09-2a“未交代”不是置信度争议，而是文本事实与判决直接相反。漏报原因也可复核：谓词只收 死／歿／去世／病故／咽氣／嚥氣／亡故／沒了，没有 身亡；文本的近身称谓又是“二姑奶奶”，不是已登记的人名锚点。

## 发现 2（W1 / W4）：A-09-1 所称“叙述语中未见受虐”也被第一〇九回推翻

复跑：

~~~bash
node demo/hongloumeng-c/judge.mjs --from 81 --to 120 --only A-09-1 --json
~~~

实得 NOT_FOUND；报告 REPORT.md:55 进一步声称“叙述语中未见”。

然而同一原文位置 wikisource-honglou-120.txt:3170：

- 人物转述先问“又是姑爷作践姑娘不成么”；
- 随后的叙述者总结是“被孙家揉搓以致身亡”。

即使把前一句按 narrationOnly 排除，后一句仍是叙述语，并明确叙述婚后在孙家遭揉搓直至死亡。当前谓词没有“揉搓”，所以漏掉。至少，“叙述语中未见”这一 REPORT 结论是事实错误；按本条 claim“迎春出嫁后遭夫虐待”的通常语义，判决也应为兑现，而不是未交代。

原文复跑命令同发现 1。

## 发现 3（W2）：C0.6 已实际放行一个坏谓词，不只是理论上可能恒绿

完整闸门当前全绿：

~~~bash
node demo/hongloumeng-c/verify-c0.mjs
~~~

但发现 1 已证明 A-09-2a 是坏谓词：目标窗口有明确死亡叙述，它仍输出 NOT_FOUND。

C0.6 没抓住它，因为 A-09-2a 声明 recall_control: "A-14-3"。实现只检查该 control 是否存在、其校准预期是否不是 NOT_FOUND；不检查 control 与被控谓词是否共享实体别名、表面词形或实际召回路径。代码位置：

- demo/hongloumeng-c/verify-c0.mjs:92：有任意 recall_unproven 字符串即可跳过；
- verify-c0.mjs:95-98：control 只验“在校准集且期望为正例”；
- judge-spec.json:485：A-09-2a 指向 A-14-3。

A-14-3 能找到“秦可卿死”，并不能证明 A-09-2a 能找到“二姑奶奶……身亡”。当前实跑正是反例。因此 C0.6 对这类坏判分器实际恒绿，命中 W2。

## 发现 4（W2 / W4）：B-01-2 的 C0“正例”本身是假正例

B-01-2 的 claim 是“茜雪于被逐之后重新出场”。复跑前八十回：

~~~bash
node demo/hongloumeng-c/judge.mjs --from 1 --to 80 --only B-01-2 --json
~~~

它报 FULFILLED，命中第 7、8、19、20 回。但：

- 第 7、8 回是茜雪被逐以前的实际出场；
- 第 19 回只是李嬷嬷回顾“上次为茶撵茜雪的事”，见语料 :692；
- 第 20 回只是回顾“将当日吃茶，茜雪出去”，见语料 :721；
- 第 19、20 回都不是茜雪本人重新出场。

定位命令：

~~~bash
rg -n "打量上次為茶攆茜雪的事|將當日吃茶，茜雪出去" demo/hongloumeng-c/corpus/wikisource-honglou-120.txt
~~~

可是 c0-calibration.json:298-300 把它注册为 FULFILLED，理由仅是“茜雪在前八十回本就多次出现”；REPORT.md:83 又据此写“本条已兑现于前八十回，后四十回不需重演”。

这证明一个只做“名字出现”的坏谓词可以通过 C0.1，并被反过来当作自证召回。该条既命中 W2，也构成 REPORT 的 W4 过强结论。

## 发现 5（W2）：C0.5 没有校准复合谓词的“每条腿”，只校验了声明字符串

verify-c0.mjs:67-69 对 legs_calibrated_by 的全部实质检查是：

1. 数组非空；
2. 所列 id 在校准集出现。

它没有检查：

- 所列 id 是否真的对应各条腿；
- 腿数与 control 数是否相符；
- control 是否为正例；
- 复合谓词执行时是否真的走过每条腿。

可复跑查看实现与现状：

~~~bash
rg -n "const legs =|const missing = legs" demo/hongloumeng-c/verify-c0.mjs
node -e "const s=require('./demo/hongloumeng-c/judge-spec.json'); const p=s.predicates.find(x=>x.id==='B-04-2'); console.log({require_present:p.require_present,legs_calibrated_by:p.legs_calibrated_by})"
~~~

B-04-2 有两个配置槽位（宝钗、麝月），但 legs_calibrated_by 只有 B-04-1；后者只证明“宝玉出家”锚点，不证明两个在场槽位的检测。前八十回锚点不存在，故 B-04-2 的槽位代码根本没有被 C0 执行到。一个“锚点正确、槽位检测永远返回 false”的坏 configuration 判分器仍能通过 C0.5。故 C0.5 与其注释所宣称的“每条腿都要单独校准”不一致，命中 W2。

## 发现 6（W4）：REPORT 对“未交代”的证据强度作出了与实验相反的结论

REPORT.md:38 写：

> “违反”与“未交代”难以人为制造，信息量更高。

现有证据不支持这个强度：

1. 仓内盲测 A-06-1-blind 因九个词都没覆盖目标措辞而产生 NOT_FOUND，已经证明“未交代”可以由窄谓词直接制造；
2. 本次 A-09-2a 又在有明确“身亡”叙述时制造了 NOT_FOUND；
3. C0.6 的 control 只证明另一谓词找得到另一人的同类事件，并不能证明本谓词的实体和词形召回。

可复跑：

~~~bash
node demo/hongloumeng-c/judge.mjs --from 81 --to 120 --only A-06-1-blind,A-09-2a --json
~~~

盲测最多支持“兑现谓词经目标文本调过，独立性较弱”；它不支持“未交代难以制造”。相反，盲测本身展示了制造 NOT_FOUND 的具体机制。因此这是 W4。

## 发现 7（W4）：多条 REPORT 结论比实际机器证据多出未检查的语义腿

### A-13-1

REPORT.md:108 把 A-13-1“李纨守寡育子”判为兑现，唯一展示证据是第 97 回的“寡二少双”。这里“寡二少双”意为少有匹敌，修饰黛玉容貌才情，不是“李纨守寡”，更没有“育子”。

复跑：

~~~bash
node demo/hongloumeng-c/judge.mjs --from 81 --to 120 --only A-13-1 --json
~~~

输出可见唯一 pattern 是裸字 寡，证据即“容貌才情真是寡二少双”。这条证据不能支撑报告结论。

### A-04-2

claim 是“林黛玉死亡，且与宝玉终未成婚”，但 judge-spec.json 的谓词只检查黛玉死亡，没有任何婚姻否定腿。复跑输出也只有死亡证据：

~~~bash
node demo/hongloumeng-c/judge.mjs --from 81 --to 120 --only A-04-2 --json
~~~

因此机器最多判了“黛玉死亡”，不能把合取命题整体标成机器已兑现。

### A-12-3

claim 是“巧姐由受过接济的村妇所救”，但谓词仅检查巧姐与刘姥姥在 200 字内同现。第 113 回证据发生在救援以前，已经被判作兑现证据。复跑：

~~~bash
node demo/hongloumeng-c/judge.mjs --from 81 --to 120 --only A-12-3 --json
~~~

故事后来确有救援，不等于该谓词检查了“救”。REPORT 把共现结果提升为因果救援结论，证据强度越界，命中 W4。

## 关于 W3：未找到，不计

我没有找到足够证据证明 revision_log 中存在“看完答案后调参，却伪装成原则性规则”的条目。相反：

- rev4、rev8 明写因后四十回漏报而改，且归类为个案缺陷；
- rev11 明写主动审计目标窗口，并声明该条不冒充盲测。

这三条虽然说明判分器确实对目标文本调过，但预注册要求的是“未如实归类”的痕迹；现有文字已作披露，所以不算 W3。

另有一项可核的报告失真但不足以证明 W3 意图：REPORT.md:28,166 声称“校准中修改判分器 12 次，逐次留痕”“每一次修改都留了痕”，而 c0-calibration.json 的 revision_log 在 rev12 结束；当前 judge-spec.json:70、:354 仍记录了未进入该 revision_log 的后续误报与两轮修正。可复跑：

~~~bash
node -e "const c=require('./demo/hongloumeng-c/c0-calibration.json'); console.log(c.revision_log.length,c.revision_log.at(-1))"
rg -n "第一〇三回.*死去活來|第一版含裸.*金陵" demo/hongloumeng-c/judge-spec.json
~~~

这足以说明 REPORT 的“逐次留痕/每一次”过强（W4），但仅凭静态文件不能证明是故意凑答案，因此不升级为 W3。

## 只读性核验

预注册保护的 9 个文件在写本报告前全部与 snapshot_before 相同：

- judge-spec.json
- c0-calibration.json
- judge.mjs
- verify-c0.mjs
- panci-spec.json
- zhipi-spec.json
- aliases.json
- REPORT.md
- task.origin.json

复核命令可用：

~~~bash
node -e "const fs=require('fs'),c=require('crypto'),p='demo/hongloumeng-c/',r=require('./demo/hongloumeng-c/handoff/review-pre-registration.json'); for(const [f,want] of Object.entries(r.snapshot_before)){const got=c.createHash('sha256').update(fs.readFileSync(p+f)).digest('hex'); console.log(got===want?'OK':'MISMATCH',f,got)}"
~~~
