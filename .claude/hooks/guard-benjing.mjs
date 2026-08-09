// guard-benjing.mjs — PreToolUse hook · 本境 v0.2 的硬拦截
//
// RFC-0005 §6.3 的漏：乐观锁只保护走 benjing-put 的写，AI 直接用 Write/Edit 覆盖
// task.origin.json 仍能绕过——那等于「提供了安全带但没强制系」。缺陷④只算修了一半。
//
// 本机常态是多会话并发（实测：写 RFC 期间另一会话往 task3 追加了 4 条已验证事实），
// 任何「读进内存 → 改 → 整体写回」都会静默吃掉别人的学历。所以这里直接拦死。
//
// 约定：PreToolUse hook 退出码 2 = 阻断工具调用，stderr 交给模型看。
import fs from 'node:fs';

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const tool = payload.tool_name || '';
if (!/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) process.exit(0);

const fp = String(payload.tool_input?.file_path || payload.tool_input?.notebook_path || '');
if (!/[\\/]task\.origin\.json$/.test(fp.replace(/\\/g, '/')) && !/^task\.origin\.json$/.test(fp)) {
  process.exit(0);
}

// 缺陷⑥在本部件复发：这个守卫**按文件名认学历**，于是把 schemas/task.origin.json
// —— 那份 JSON Schema 本身 —— 也当成学历拦了。benjing-core 早在 v0.2 就为同一个
// 误判付过学费并写下结论：「所以必须按 kind 认，不能按文件名认」（benjing-core.mjs:141），
// 而这里没跟上。判据规则会随仓库长出新东西而滞后，这是本仓库的惯犯。
//
// 放行条件与 benjing-core 的 scanStateFiles 保持字面一致：有 $schema、且没有 kind。
// 文件不存在（新建）时不放行——读不到内容就无法判断，安全默认是继续拦。
try {
  const o = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (o && o.$schema && o.kind === undefined) process.exit(0);
} catch { /* 读不到/解析不了 → 按学历拦住 */ }

const q = `"${fp}"`; // 本仓库路径含空格与中文，提示里的命令必须自带引号，否则照抄会挂
process.stderr.write([
  `已阻断：${tool} 直接写 ${fp}。`,
  `学历文件必须走本境 v0.2 的乐观锁入口，否则会静默吃掉其他并发会话刚写入的已验证事实（实测发生过）。`,
  ``,
  `改用（在仓库根执行）：`,
  `  node southbridge/benjing-put.mjs --show ${q}                      # 拿 computed_hash`,
  `  node southbridge/benjing-put.mjs ${q} --expect <hash> --from <新状态.json>`,
  `  # 新建加 --create；退出码 0=成功 3=diverged(有人改过,去合并) 4=denied(没带 expect)`,
  ``,
  `注意：写之前必须重新读盘，不要用会话早期读到的那份内存副本。`
].join('\n'));
process.exit(2);
