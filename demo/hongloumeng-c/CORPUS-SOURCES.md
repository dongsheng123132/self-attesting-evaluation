# C 轨语料：来源、指纹、能不能重建

> 写这份文件的直接原因：把 C 轨提交进版本库时才发现，**判分器运行时读的那两份语料没有重建脚本**。
> 其余三轨的语料可以放心忽略，是因为 `demo/fetch-corpus.mjs` 真能把它们按指纹取回来。
> C 轨不行。按目录一刀切 `.gitignore` 会让本轨全部结论变成第三方不可复跑，
> 而那正是本仓库反复批的那个病——「看起来齐全，其实缺一块，且没人被告知」。
>
> 所以这里按**能不能重建**逐份处置，并把不能重建的那几份如实标出来。

## 全部七份 + 一份外部文本

| 文件 | sha256 | 进 git？ | 重建路径 |
|---|---|---|---|
| `corpus/wikisource-honglou-120.txt` | `1e9bee4d…95bd` | **是** | ❌ 无。本机加工产物 |
| `corpus/zhipi-raw.json` | `40d97fc2…0ead` | **是** | ❌ 无。本机加工产物 |
| `corpus/wikisource-honglou-c005.txt` | `936895a0…6abf` | **是** | ❌ 无。本机加工产物（24K） |
| `corpus/pg24264-honglou.txt` | `ff152699…2011` | 否 | ✅ `fetch-corpus.mjs` |
| `corpus/pg23962.txt` | `af3c9e40…cf58` | 否 | ✅ `fetch-corpus.mjs` |
| `corpus/pg23863.txt` | `9d5b723b…4789` | 否 | ✅ `fetch-corpus.mjs` |
| `corpus/pg24032.txt` | `98a08c88…0393` | 否 | ✅ `fetch-corpus.mjs` |
| `handoff/blind/corpus/wikisource-honglou-080.txt` | `fd6e9ceb…1aaca` | 否 | ✅ 见下「盲测副本」 |
| `external/xubian-rewrite.md` | `0ebe1943…e565` | **否，且刻意不进** | 见下「别人的作品」 |

完整指纹现跑：

```bash
sha256sum demo/hongloumeng-c/corpus/* demo/hongloumeng-c/external/*.md
```

## 三份不可重建的，为什么还是让它们进 git

`judge.mjs` 读 `corpus/wikisource-honglou-120.txt`（见 `judge-spec.json` 的 `defaults.corpus`），
`verify-zhipi-spec.mjs` 读 `corpus/zhipi-raw.json`。**这两份不在，闸门跑不起来，
REPORT / GAP-FOR-CONTINUATION 一个字都生不出来**，「怎么反驳我们」那一节就成了空话。

它们是从 zh.wikisource 抓取后**在会话里**加工出来的：删模板、展开 `{{center}}` 保住回目、
拼接分页。加工代码当时没有落成脚本，只作为工具调用发生过一次——
所以今天没有任何人（包括我们换台机器）能重新造出**同一个字节序列**。
第一版还错过一次：通配删模板把 120 条回目连内容一起删了，字数 865,612，
修好后是 867,968，指纹也换了（两个 sha256 都记在学历 facts 里，没有覆盖旧的）。

**结论**：能重建的按指纹忽略，不能重建的进版本库。5.3 MB 的代价换 C 轨可复跑。
把「无重建脚本」这件事本身留在这里，而不是留在某个人的记忆里。

> 待办（已进学历 next_steps）：把 wikisource 抓取与清洗写成 `build-corpus.mjs`，
> 让这三份也变成「按指纹可重建」。在那之前，本表第四列的 ❌ 就是它的真实状态。

## 盲测副本

`handoff/blind/corpus/wikisource-honglou-080.txt` 是 120 回本的**逐字节前缀**（已实测验证）：

```bash
head -c 1776208 demo/hongloumeng-c/corpus/wikisource-honglou-120.txt \
  > demo/hongloumeng-c/handoff/blind/corpus/wikisource-honglou-080.txt
sha256sum demo/hongloumeng-c/handoff/blind/corpus/wikisource-honglou-080.txt
# 应得 fd6e9cebb362abe0184f0de2181c7f2861be88e21e7b4cc594ea38ea6111aaca
```

盲测的意义在于「谓词写作时没读过目标文本」，这由 `handoff/blind-pre-registration.json`
的封存时点保证，不由语料文件多存一份保证。所以它忽略。

## 别人的作品

`external/xubian-rewrite.md` 是同事公开的《红楼梦续编·重写本》第一二一至一二五回，
21,729 字（去空白），`sha256=0ebe194b3695f544695f7b204e1797d4b77f164a7cc31086f97376856eebe565`。

**不进版本库**，理由与 `PUBLICATION-POLICY.md` §2 的「客户真实工作区」同条：是别人的东西，不是我们的。
我们对它的**判决**（`judge-external.mjs` 的输出、1/9 的结论、逐条证据摘句）留在仓库里，正文不留。

第三方要复核这一条，需要自行从原发布处取得同一份文本、核对上面的指纹一致，再跑：

```bash
node demo/hongloumeng-c/judge-external.mjs
```

指纹不一致就说明拿到的不是同一版，此时判决不可比——这正是记指纹的用处。

---

_本文件是人写的说明，不是生成物。改语料处置方式时，改这里、改 `.gitignore`、改 `fetch-corpus.mjs`，
三处一起改；只改一处会造出一个「看起来有理由、其实理由指向别的做法」的状态。_
