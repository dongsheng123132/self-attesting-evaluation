# 任务（第 2 版）：从《红楼梦》原文抽取硬事实（只抽取，不推理）

> **第 1 版失败原因（请先读）**
> 你上一轮交付的 80 条，引文**全部**逐字命中原文，这一点没有问题。
> 失败在**方向**：同一张表里混用了两套相反的读法——
> - `K-055  subject=賈政, relation=母, object=史氏太君` → 读作「贾政**的**母是史氏太君」✅
> - `K-056  subject=邢夫人, relation=妻, object=賈赦` → 读作「邢夫人**的**妻是贾赦」❌（应是「贾赦的妻是邢夫人」）
>
> 两条的引文都是真的。问题是同一个字段组合被你用两种相反的意思编码，
> 下游程序无论按哪套解释，都会有一批记录被反向读取。
> 本版加了一个 `sentence` 字段专门消除这个歧义，请务必照做。

## 你要读的文件
`D:\uking编程\ShadowOS = Harness OS\demo\hongloumeng-c\work\excerpt-ch2-4.txt`

《红楼梦》第二、三、四回原文（繁体）。第二回冷子兴演说荣国府，贾府世系交代得最完整。

## 你要产出的文件
`D:\uking编程\ShadowOS = Harness OS\demo\hongloumeng-c\work\hermes-facts-v2.json`

## 唯一的读法（全表必须统一，不许有例外）

> **`<subject>` 的 `<relation>` 是 `<object>`**

念得通才对，念不通就是 subject 和 object 写反了，调换过来即可。

## 产出格式（严格 JSON，不要 markdown 代码块，不要解释文字）

```
{
  "facts": [
    {
      "id": "K-001",
      "kind": "kinship",
      "subject": "賈寶玉",
      "relation": "父",
      "object": "賈政",
      "sentence": "賈寶玉的父是賈政",
      "chapter": "第二回",
      "grounding": "不想後來又生一位公子"
    }
  ]
}
```

`sentence` 字段 = 把 subject/relation/object 三个字段**原样**拼成 `<subject>的<relation>是<object>`，中间不加别的字。
**写完每一条，念一遍 `sentence`。念出来是错的，就调换 subject 和 object。**

### 三个对照例子（务必看懂再动手）

| 原文 | ❌ 错误写法 | ✅ 正确写法 |
|---|---|---|
| `原來這李氏即賈珠之妻` | subject=李紈, relation=妻, object=賈珠<br>（念作「李纨的妻是贾珠」，不通） | subject=賈珠, relation=妻, object=李紈<br>（念作「贾珠的妻是李纨」，通） |
| `時賈赦之妻邢氏忙亦起身` | subject=邢夫人, relation=妻, object=賈赦 | subject=賈赦, relation=妻, object=邢夫人 |
| `賈赦賈政之母也` | —— | subject=賈政, relation=母, object=史氏太君<br>（念作「贾政的母是史氏太君」，通） |

**记忆法**：中文的「X 之 R」里，X 是**被拥有方的拥有者**，所以 X 一定放 `subject`。

## 字段说明
- `kind`：`kinship` 亲属 / `office` 官职封号 / `appellation` 称谓 / `object` 器物归属 / `age` 年龄时序
- `relation`：kinship 用 父/母/子/女/兄/弟/姊/妹/夫/妻/祖父/祖母/孫/孫女/侄/舅/姑/姨/媳；其余 kind 用简短说明
- `subject`/`object`：用原文里的正式姓名（「賈政」「林黛玉」），不用小名代称
- `chapter`：`第二回`/`第三回`/`第四回`
- `grounding`：**原文逐字连续片段，8–40 字**

## 铁律（违反任一条，该条作废）

1. `grounding` 必须是原文一字不差的**连续**片段。不许改写、缩写、调标点、拼接两处。程序会逐字回查，并且会核对它是否真在你声称的**那一回**里。
2. 只抽原文明说的，不推理。
3. 找不到原文支持就不写。**少写不扣分，编造和写反是最严重的错误。**
4. 繁体照抄原文，不转简体。
5. `grounding` 不含 `{{ }}【 】` 等标记。
6. 尽量让 `grounding` 里同时出现 subject 和 object 的名字（哪怕是「珠」「赦」这样的单字简称）。做不到就换一处能做到的原文。

## 数量目标
40–80 条。**质量优先。**

## 交付前自检（这次请真的做）
1. 逐条念 `sentence`，把念不通的调换过来。
2. 随机挑 8 条，回原文搜 `grounding`，确认一字不差且在声称的那一回。
3. 统计一下：有多少条的 `grounding` 里同时出现了 subject 和 object。
