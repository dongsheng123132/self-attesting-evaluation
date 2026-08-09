- `demo/ulysses-19/task.origin.json`
- `demo/spenser-7-1/task.origin.json`

## 项目要证明的主张

用廉价模型（deepseek via Hermes）+ 本项目的状态协议，完成英语文学中最难的连续性任务：
- A 轨：《尤利西斯》第 19 回（乔伊斯 Linati 图式里唯一没映射《奥德赛》第 24 卷的空位）
- B 轨：《仙后》第七卷第一章（斯宾塞《致罗利书》写明 12 卷、实际只写了 6 卷 + 变易篇残卷）

核心可辩护主张（不是"文笔好"）：
> N 条机器可检约束全绿；稿子跨 M 会话、K harness、3 模型产出，任何会话都没看过上一个会话的聊天记录，只看状态。

关键实验是三臂 A/B/C：
- A = deepseek + 状态协议 → 约束通过率 X
- B = deepseek 裸跑 → Y
- C = 前沿模型裸跑 → Z
预期头条："X > Z，状态战胜模型规模"。

关键闸门 C0：6 个（A轨）/ 2 个（B轨）验证器**必须先在原著上跑出基线**才允许开写正文；
合格线取"原作者本人的实测违规率"，不是 100%。

## 我要你回答的（每条给出你认为的失败概率与理由）

1. **实验设计有没有致命缺陷？** 特别是：X > Z 这个结论有没有可能是被约束集的设计方式"构造"出来的？
   （本仓 papers/self-attesting-evaluation.md 案例 1 就是一次"构造出来的结论"被自己撤回，别重蹈。）
2. **A/B/C 三臂的公平性**：怎么保证 B、C 臂不是被故意削弱的稻草人？提示词、轮数、重试次数怎么对齐？
3. **哪几条判据实际上是不可机检的**，只是听起来可机检？（尤其 U1 图式实证、U5 正典矛盾、S2.3 与残卷不矛盾）
4. **词汇年代闸用 Ngrams+Wiktionary 近似代替 OED**，这个近似会不会大到让判据失去意义？
5. **法律**：1922 初版 PD 的结论有没有你知道的例外或地区风险？（爱尔兰/英国/美国）
6. **传播风险**：作为工程演示发布，最可能被怎样曲解成"AI 续写名著"？有没有更好的措辞？
7. **有没有一个比这两部更适合的靶子**是我们漏掉的？给理由，别只报书名。
8. **六周排期哪一周最可能崩**？

输出要求：**简明**，按 1–8 编号，每条 3–6 句，直接说结论和理由。不要复述我的规格。
最后加一节「如果只能改一件事」，只写一条。

warning: Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.
codex
我先按仓库规则读取两份学历与自证评估案例，再核对其中的判据、实验臂和六周排期。法律问题具有时效与地域风险，我会另外查英、美、爱尔兰的一手版权规则。
exec
"C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\\pwsh.exe" -Command "git status --short; git log -5 --oneline; Get-Content -Raw -LiteralPath 'demo/ulysses-19/task.origin.json'; Get-Content -Raw -LiteralPath 'demo/spenser-7-1/task.origin.json'; Get-Content -Raw -LiteralPath 'papers/self-attesting-evaluation.md'" in D:\uking编程\ShadowOS = Harness OS
2026-08-09T13:34:42.442395Z ERROR codex_core::exec: exec error: windows sandbox: runner failed during SpawnChild: CreateProcessAsUserW failed: 5 (拒绝访问。) | cwd=D:\uking编程\ShadowOS = Harness OS | cmd="C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\pwsh.exe" -NoProfile -Command "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}
git status --short; git log -5 --oneline; Get-Content -Raw -LiteralPath 'demo/ulysses-19/task.origin.json'; Get-Content -Raw -LiteralPath 'demo/spenser-7-1/task.origin.json'; Get-Content -Raw -LiteralPath 'papers/self-attesting-evaluation.md'" | env_u16_len=12801 | si_flags=256 | creation_flags=525312 (Windows error 5)
2026-08-09T13:34:42.442682Z ERROR codex_core::tools::router: error=execution error: Io(Custom { kind: Other, error: "windows sandbox: runner failed during SpawnChild: CreateProcessAsUserW failed: 5 (拒绝访问。) | cwd=D:\\uking编程\\ShadowOS = Harness OS | cmd=\"C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\\pwsh.exe\" -NoProfile -Command \"try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\ngit status --short; git log -5 --oneline; Get-Content -Raw -LiteralPath 'demo/ulysses-19/task.origin.json'; Get-Content -Raw -LiteralPath 'demo/spenser-7-1/task.origin.json'; Get-Content -Raw -LiteralPath 'papers/self-attesting-evaluation.md'\" | env_u16_len=12801 | si_flags=256 | creation_flags=525312 (Windows error 5)" })
 exited -1 in 0ms:
execution error: Io(Custom { kind: Other, error: "windows sandbox: runner failed during SpawnChild: CreateProcessAsUserW failed: 5 (拒绝访问。) | cwd=D:\\uking编程\\ShadowOS = Harness OS | cmd=\"C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\\pwsh.exe\" -NoProfile -Command \"try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\ngit status --short; git log -5 --oneline; Get-Content -Raw -LiteralPath 'demo/ulysses-19/task.origin.json'; Get-Content -Raw -LiteralPath 'demo/spenser-7-1/task.origin.json'; Get-Content -Raw -LiteralPath 'papers/self-attesting-evaluation.md'\" | env_u16_len=12801 | si_flags=256 | creation_flags=525312 (Windows error 5)" })
codex
本地命令首次被 Windows 沙箱拒绝启动；我会换成更小的只读调用继续取证，不会改动仓库。
exec
"C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\\pwsh.exe" -NoProfile -Command Get-Location in D:\uking编程\ShadowOS = Harness OS
2026-08-09T13:34:59.246893Z ERROR codex_core::exec: exec error: windows sandbox: runner failed during SpawnChild: CreateProcessAsUserW failed: 5 (拒绝访问。) | cwd=D:\uking编程\ShadowOS = Harness OS | cmd="C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\pwsh.exe" -NoProfile -Command "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}
Get-Location" | env_u16_len=12801 | si_flags=256 | creation_flags=525312 (Windows error 5)
2026-08-09T13:34:59.247067Z ERROR codex_core::tools::router: error=execution error: Io(Custom { kind: Other, error: "windows sandbox: runner failed during SpawnChild: CreateProcessAsUserW failed: 5 (拒绝访问。) | cwd=D:\\uking编程\\ShadowOS = Harness OS | cmd=\"C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\\pwsh.exe\" -NoProfile -Command \"try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\nGet-Location\" | env_u16_len=12801 | si_flags=256 | creation_flags=525312 (Windows error 5)" })
 exited -1 in 0ms:
execution error: Io(Custom { kind: Other, error: "windows sandbox: runner failed during SpawnChild: CreateProcessAsUserW failed: 5 (拒绝访问。) | cwd=D:\\uking编程\\ShadowOS = Harness OS | cmd=\"C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\\pwsh.exe\" -NoProfile -Command \"try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\nGet-Location\" | env_u16_len=12801 | si_flags=256 | creation_flags=525312 (Windows error 5)" })
mcp: node_repl/js started
mcp: node_repl/js (completed)
mcp: node_repl/js started
mcp: node_repl/js (completed)
mcp: node_repl/js started
mcp: node_repl/js (completed)
codex
两份状态暴露出一个更早的风险：U1–U7、三臂资源预算和统计方案尚未真正冻结，因此“先校准再写”还不足以防止事后改题。接下来我重点核查 Linati“唯一空位”是否成立，以及三地版权边界。
web search: 
web search: site:copyright.gov works published 1922 public domain copyright duration circular ...
web search: 
web search: 
web search: 
web search: site:legislation.gov.uk/ukpga/1988/48/section/12 copyright expires 70 years end calendar year ...
web search: 
web search: Spenser Letter to Raleigh twelve books twelve private moral virtues text primary source ...
web search: 
web search: Google Books Ngram Viewer datasets OCR errors metadata errors official paper ...
web search: 
web search: 
codex
以下概率指“该问题足以使相应主张站不住”的主观估计。

1. **实验设计致命失败概率：85%。** X>Z 很容易被构造出来：A 臂拿到约束清单、结构化状态和验证器反馈并反复爬分，B/C 却“裸跑”，测到的是“答案表+搜索预算”的收益，不是持久状态的收益。把验证器调到原著通过只能证明它与原著兼容，不能证明它测到了连续性；反复调绿本身还是数据泄漏。最后，单篇稿子的 N 条相关约束不是 N 个独立样本，没有预注册、隐藏判据和多任务重复，头条结论没有统计识别力。

2. **三臂公平性失败概率：90%。** 当前设计同时混淆模型、记忆形式、上下文长度、工具、会话数、验证器反馈和修订次数。应改成“模型 × 记忆条件”的因子实验，至少加入 deepseek/前沿模型各自的状态臂、等 token transcript 臂和等长静态 dossier 臂。所有臂必须共享冻结的来源包、初始提示词、总输入/输出 token、工具权限、有效生成调用数和质量修订上限。传输错误重试单列为仪器故障，不能顺便多一次生成；提示词哈希、随机种子、失败输出和全部弃样数必须公开。

3. **“机器可检”失实概率：95%。** U1 最多能检查“人工编码的 Linati 表是否自洽”，不能证明编码正确或存在作者留下的唯一空位；公开转录的图式列的是 18 个 episode 标题而非《奥德赛》24 卷覆盖表，而且 Penelope 行已经出现 Laertes，[这本身就使“XXIV 唯一未映射”成为待证诠释](https://en.wikipedia.org/wiki/Linati_schema_for_Ulysses)。U5 和 S2.3 都是开放世界的叙事蕴含判断：程序只能检查人工事实账本，不能证明全文不存在矛盾。更麻烦的是，“变易篇属于第七卷 Constancie”本身来自 1609 年出版者的 posthumous designation，而非明确作者编号，[现代研究也把它表述为出版者判断](https://doi.org/10.1086/733373)。抑扬格、历史发音、眼韵、德目是否真正体现也不是 100% 自动判定；应改称“自动筛查+盲审裁决”，并报告评审一致率。

4. **词汇年代闸失去判别意义的概率：80%。** Ngrams 测的是扫描书库里的字符串频率，不是词义级首见年；Google 自己说明结果会随 OCR、语言识别和语料增补而变化，[不同数据版本也会改图](https://books.google.com/ngrams/info)。古拼写会造成大量漏报，OCR 和错误书目年份会造成伪早现，且同形异义无法区分。Wiktionary 允许词条、词义和词源进入待核状态，[其验证制度本身说明资料并非稳定金标准](https://en.wiktionary.org/wiki/Help%3ARequests_for_verification)。没有一批用 OED/EEBO 等人工标注的盲测词，就无从声称“公布误判率”；该闸只能输出“已见/未见/不确定”，不能直接判失败。

5. **版权导致发布被阻断的概率：15%。** 美国方面很稳：版权局目前明确写明，1931 年前出版或取得版权的作品已经期满，[1922 文本在范围内](https://www.copyright.gov/circs/circ22.pdf)。英国和爱尔兰的文学作品通常都是作者死后 70 年，[英国规则](https://www.gov.uk/copyright/how-long-copyright-lasts)与[爱尔兰法第 24 条](https://www.irishstatutebook.ie/eli/2000/act/28/section/24/enacted/en/html)均支持乔伊斯原文自 2012 年起无著作权障碍。真正风险是误取 Gabler 等现代校订、注释、译文、扫描图或新版排印；新增编辑材料和版式可能有独立权利。另应避免“James Joyce’s Chapter 19”式署名，防止虚假来源、商标或 passing-off 争议；PD 不是全球发行的完整法律清白证明。

6. **被传播成“AI 续写名著”的概率：80%。** “第19回”“重建”“作者留下的空位”会压过所有工程限定，媒体标题几乎必然只剩“AI 完成《尤利西斯》”。尤其若提供封面、连贯全文或仿作者署名，读者会把它当文学仿作评价，约束实验反而消失。建议统一称为“非正典、公有领域文本上的状态化约束基准”，并把任务描述为“研究者定义的反事实缺口”，不要叫“失落章节”或“重建”。正文放附录，每个文件页首永久标注 non-canonical benchmark artifact，主页面先展示实验协议、失败率和审计记录。

7. **靶子选择不理想的概率：65%；更好的候选是福尔摩斯正典中的“未叙案件”集合。** 华生明确提到过多宗未展开案件，可以形成十几个相同任务结构的实例，而不是围绕一篇稿子制造大量伪独立判据。它们有明确的案名、人物、叙述者和时间边界，语言与韵律检测也远比乔伊斯或早期现代英语可靠。更重要的是，可以预留若干案件及其约束做隐藏测试集，从而真正比较状态与模型规模；缺点是必须排查既有仿作和训练集污染。

8. **最可能崩的是 W2，概率：85%。** 六个 A 轨验证器中的 schema、canon、motif 至少三个无法按承诺自动判真，B 轨的历史格律和 S2.3 也会在校准时暴露大量歧义。若 W2 用规则硬凑过去，项目不会按工程进度崩，而会在 W5 以“验证器只验证自己的标注”这种科学失败方式崩。排期里甚至没有 W4，这说明尚未为盲审、误差标注、预实验和返工预留时间。

### 如果只能改一件事

把三臂改成预注册的“模型 × 记忆形式”因子实验，并使用多个任务、等计算预算、独立制定且生成阶段不可见的隐藏判据。
tokens used
122,620
以下概率指“该问题足以使相应主张站不住”的主观估计。

1. **实验设计致命失败概率：85%。** X>Z 很容易被构造出来：A 臂拿到约束清单、结构化状态和验证器反馈并反复爬分，B/C 却“裸跑”，测到的是“答案表+搜索预算”的收益，不是持久状态的收益。把验证器调到原著通过只能证明它与原著兼容，不能证明它测到了连续性；反复调绿本身还是数据泄漏。最后，单篇稿子的 N 条相关约束不是 N 个独立样本，没有预注册、隐藏判据和多任务重复，头条结论没有统计识别力。

2. **三臂公平性失败概率：90%。** 当前设计同时混淆模型、记忆形式、上下文长度、工具、会话数、验证器反馈和修订次数。应改成“模型 × 记忆条件”的因子实验，至少加入 deepseek/前沿模型各自的状态臂、等 token transcript 臂和等长静态 dossier 臂。所有臂必须共享冻结的来源包、初始提示词、总输入/输出 token、工具权限、有效生成调用数和质量修订上限。传输错误重试单列为仪器故障，不能顺便多一次生成；提示词哈希、随机种子、失败输出和全部弃样数必须公开。

3. **“机器可检”失实概率：95%。** U1 最多能检查“人工编码的 Linati 表是否自洽”，不能证明编码正确或存在作者留下的唯一空位；公开转录的图式列的是 18 个 episode 标题而非《奥德赛》24 卷覆盖表，而且 Penelope 行已经出现 Laertes，[这本身就使“XXIV 唯一未映射”成为待证诠释](https://en.wikipedia.org/wiki/Linati_schema_for_Ulysses)。U5 和 S2.3 都是开放世界的叙事蕴含判断：程序只能检查人工事实账本，不能证明全文不存在矛盾。更麻烦的是，“变易篇属于第七卷 Constancie”本身来自 1609 年出版者的 posthumous designation，而非明确作者编号，[现代研究也把它表述为出版者判断](https://doi.org/10.1086/733373)。抑扬格、历史发音、眼韵、德目是否真正体现也不是 100% 自动判定；应改称“自动筛查+盲审裁决”，并报告评审一致率。

4. **词汇年代闸失去判别意义的概率：80%。** Ngrams 测的是扫描书库里的字符串频率，不是词义级首见年；Google 自己说明结果会随 OCR、语言识别和语料增补而变化，[不同数据版本也会改图](https://books.google.com/ngrams/info)。古拼写会造成大量漏报，OCR 和错误书目年份会造成伪早现，且同形异义无法区分。Wiktionary 允许词条、词义和词源进入待核状态，[其验证制度本身说明资料并非稳定金标准](https://en.wiktionary.org/wiki/Help%3ARequests_for_verification)。没有一批用 OED/EEBO 等人工标注的盲测词，就无从声称“公布误判率”；该闸只能输出“已见/未见/不确定”，不能直接判失败。

5. **版权导致发布被阻断的概率：15%。** 美国方面很稳：版权局目前明确写明，1931 年前出版或取得版权的作品已经期满，[1922 文本在范围内](https://www.copyright.gov/circs/circ22.pdf)。英国和爱尔兰的文学作品通常都是作者死后 70 年，[英国规则](https://www.gov.uk/copyright/how-long-copyright-lasts)与[爱尔兰法第 24 条](https://www.irishstatutebook.ie/eli/2000/act/28/section/24/enacted/en/html)均支持乔伊斯原文自 2012 年起无著作权障碍。真正风险是误取 Gabler 等现代校订、注释、译文、扫描图或新版排印；新增编辑材料和版式可能有独立权利。另应避免“James Joyce’s Chapter 19”式署名，防止虚假来源、商标或 passing-off 争议；PD 不是全球发行的完整法律清白证明。

6. **被传播成“AI 续写名著”的概率：80%。** “第19回”“重建”“作者留下的空位”会压过所有工程限定，媒体标题几乎必然只剩“AI 完成《尤利西斯》”。尤其若提供封面、连贯全文或仿作者署名，读者会把它当文学仿作评价，约束实验反而消失。建议统一称为“非正典、公有领域文本上的状态化约束基准”，并把任务描述为“研究者定义的反事实缺口”，不要叫“失落章节”或“重建”。正文放附录，每个文件页首永久标注 non-canonical benchmark artifact，主页面先展示实验协议、失败率和审计记录。

7. **靶子选择不理想的概率：65%；更好的候选是福尔摩斯正典中的“未叙案件”集合。** 华生明确提到过多宗未展开案件，可以形成十几个相同任务结构的实例，而不是围绕一篇稿子制造大量伪独立判据。它们有明确的案名、人物、叙述者和时间边界，语言与韵律检测也远比乔伊斯或早期现代英语可靠。更重要的是，可以预留若干案件及其约束做隐藏测试集，从而真正比较状态与模型规模；缺点是必须排查既有仿作和训练集污染。

8. **最可能崩的是 W2，概率：85%。** 六个 A 轨验证器中的 schema、canon、motif 至少三个无法按承诺自动判真，B 轨的历史格律和 S2.3 也会在校准时暴露大量歧义。若 W2 用规则硬凑过去，项目不会按工程进度崩，而会在 W5 以“验证器只验证自己的标注”这种科学失败方式崩。排期里甚至没有 W4，这说明尚未为盲审、误差标注、预实验和返工预留时间。

### 如果只能改一件事

把三臂改成预注册的“模型 × 记忆形式”因子实验，并使用多个任务、等计算预算、独立制定且生成阶段不可见的隐藏判据。
