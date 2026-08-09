// oob-probe.mjs — SessionStart hook · 带外观察面（oob/0.1）
//
// 为什么它是**独立的一条 hook**，而不是并进北桥的 boot 摘要里：
//   观察者不该长在被观察者体内（RFC-0002 R1：独立 = 不共享失效模式）。
//   北桥挂了、本境坏了、学历全丢了——这一行仍然要能打出来，且仍然准。
//   合进 compile.mjs 就等于把带外观察变成带内观察，那这东西就白做了。
//
// 它回答一个之前没人回答过的问题：**这台机器现在还是不是好的？**
// （案子 4：本机 codex 沙箱 runner 坏了整整一个任务周期没被发现，
//   因为没有任何人观察过 harness 本身是否健康。成本就是这三行。）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function emit(ctx) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx }
  }));
  process.exit(0);
}

try {
  const { snapshot, summaryLine } = await import(
    'file://' + path.resolve(here, '..', '..', 'oob', 'env-probe.mjs').replace(/\\/g, '/')
  );
  emit('[带外观察 · oob/0.1] ' + summaryLine(snapshot()));
} catch (e) {
  // 探针自己挂了也要说出来 —— 静默即缺陷，这条律对观察者本身同样适用
  emit(`[带外观察 · oob/0.1] ⚠ 探针未能运行：${e.message}　—— 本轮环境健康未知，不要当作正常`);
}
