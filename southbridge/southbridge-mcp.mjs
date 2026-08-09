// southbridge-mcp.mjs — 本源南桥 · MCP 驱动（影核 v0.2）
//
// 这里只剩传输层：MCP stdio JSON-RPC 的握手、工具清单、调用转发。
// 所有判断（风险分级、批准、写后观察、action.result）都在 shadowcore-core.mjs，
// 与 CLI 驱动共用同一份核心——这就是「一核多影」的一影。
//
// 已知限制（实测 2026-08-08，codex-cli 0.147.0）：
//   MCP 通道会被 harness 自己的工具审批闸门整体堵死（tools/call 返回
//   "user cancelled MCP tool call"，南桥 audit.log 零记录）。
//   headless 场景请改用 southbridge-cli.mjs。见 RFC-0004 §6.6。
import { TOOLS, doWrite, doVerify } from './shadowcore-core.mjs';

const ACTOR = 'southbridge_mcp';

function handleReq(req) {
  const { id, method, params = {} } = req;

  if (method === 'initialize') {
    return { id, jsonrpc: '2.0', result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'southbridge', version: '0.2.0' }
    }};
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') return { id, jsonrpc: '2.0', result: { tools: TOOLS } };

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    let result;
    if (name === 'southbridge_write') result = doWrite(args, ACTOR);
    else if (name === 'southbridge_verify') result = doVerify(args, ACTOR);
    else return { id, jsonrpc: '2.0', result: { content: [{ type: 'text', text: 'unknown tool' }], isError: true } };

    const isError = result.status !== 'done' && result.status !== 'replayed';
    return { id, jsonrpc: '2.0', result: {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError
    }};
  }

  return { id, jsonrpc: '2.0', error: { code: -32601, message: 'method not found' } };
}

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const req = JSON.parse(line);
      const resp = handleReq(req);
      if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
    } catch { /* malformed line, ignore */ }
  }
});
process.stdin.on('end', () => process.exit(0));
