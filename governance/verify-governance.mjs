#!/usr/bin/env node
import {
  buildPublishableExport, canShareContext, governanceIssues,
  normalizeGovernance, redactOperationalText
} from './policy.mjs';

const results = [];
const t = (id, desc, fn) => {
  try { const r = fn(); results.push({ id, desc, ok: r === true, detail: r === true ? '' : String(r) }); }
  catch (e) { results.push({ id, desc, ok: false, detail: 'EXCEPTION: ' + e.message }); }
};
const G = (over = {}) => ({
  tenant_id: 'tenant-a', project_id: 'project-a', visibility: 'project',
  sensitivity: 'confidential', context_access: 'project', export_policy: 'deny',
  retention_days: 30, ...over
});
const S = (id, governance, over = {}) => ({
  kind: 'task.origin', id, governance, facts: [], decisions: [], actions: [],
  artifacts: [], learnings: [], next_steps: [], ...over
});

t('G1.1', '【反向】无治理元数据默认隔离且禁止导出', () => {
  const g = normalizeGovernance(S('legacy'));
  return (!g.classified && g.context_access === 'task' && g.export_policy === 'deny') || JSON.stringify(g);
});
t('G1.2', '【反向】两份未分类学历即使 scope 文本相同也不能互相共享', () =>
  canShareContext({ id: 'a', scope: 'project:same' }, { id: 'b', scope: 'project:same' }) === false || 'legacy scope 绕过了隔离');
t('G2.1', '同租户同项目且显式 project access 才能共享', () =>
  canShareContext(S('a', G()), S('b', G())) === true || '同项目被误拦');
t('G2.2', '【反向】跨租户不能共享', () =>
  canShareContext(S('a', G()), S('b', G({ tenant_id: 'tenant-b' }))) === false || '跨租户泄露');
t('G2.3', '【反向】跨项目不能共享', () =>
  canShareContext(S('a', G()), S('b', G({ project_id: 'project-b' }))) === false || '跨项目泄露');
t('G2.4', '【反向】restricted 或 private 不得声明跨任务共享', () => {
  const a = S('a', G({ sensitivity: 'restricted' }));
  const b = S('b', G({ visibility: 'private' }));
  return governanceIssues(a).length > 0 && governanceIssues(b).length > 0 || '不自洽的治理声明未被识别';
});
t('G2.5', 'global 共享只允许 public/public', () => {
  const pub = S('pub', G({ visibility: 'public', sensitivity: 'public', context_access: 'global', export_policy: 'allow' }));
  const other = S('other', G({ tenant_id: 'x', project_id: 'y' }));
  return governanceIssues(pub).length === 0 && canShareContext(pub, other) || '合法公开知识未能全局共享';
});
t('G3.1', '【反向】export_policy=deny 不产生 document', () => {
  const r = buildPublishableExport(S('a', G()));
  return (!r.ok && !r.document) || JSON.stringify(r);
});
t('G3.2', 'redacted 导出只含统计，不含客户文本/路径/actor', () => {
  const state = S('客户甲', G({ export_policy: 'redacted' }), {
    title: '客户甲教材', current_state: 'D:\\客户\\秘密.docx', actor: { session_id: 'secret' },
    facts: [{ claim: '作者张三', verified: true, source: 'D:\\客户\\秘密.docx' }]
  });
  const r = buildPublishableExport(state); const txt = JSON.stringify(r.document);
  return r.ok && r.status === 'redacted' && !/客户甲|张三|秘密|session_id|state_ref|project_ref/.test(txt) || txt;
});
t('G3.3', '【反向】allow 但非 public/public 时拒绝', () => {
  const r = buildPublishableExport(S('a', G({ export_policy: 'allow' })));
  return (!r.ok && r.reason === 'unsafe_export') || JSON.stringify(r);
});
t('G3.4', 'public allow 仍移除本机路径、邮箱与 session_id', () => {
  const state = S('public', G({ visibility: 'public', sensitivity: 'public', context_access: 'global', export_policy: 'allow' }), {
    title: '公开报告', goal: '联系 a@example.com，读取 C:\\Users\\Alice\\secret.txt',
    actor: { harness: 'codex', model: 'gpt', session_id: 'do-not-export' },
    facts: [{ claim: '文件在 C:\\Users\\Alice\\secret.txt', verified: true, source: 'a@example.com' }]
  });
  const r = buildPublishableExport(state); const txt = JSON.stringify(r.document);
  return r.ok && /\[local-path\]|\[email\]/.test(txt) && !/Alice|example\.com|do-not-export/.test(txt) || txt;
});
t('G3.5', '脱敏函数对普通文字不做无依据改写', () =>
  redactOperationalText('公开的普通结论') === '公开的普通结论' || '普通文字被改写');
t('G3.6', '【反向】private/restricted 即使只申请 redacted 也拒绝', () => {
  const a = buildPublishableExport(S('a', G({ visibility: 'private', context_access: 'task', export_policy: 'redacted' })));
  const b = buildPublishableExport(S('b', G({ sensitivity: 'restricted', context_access: 'task', export_policy: 'redacted' })));
  return !a.ok && a.reason === 'private_export' && !b.ok && b.reason === 'restricted_export'
    || JSON.stringify({ a, b });
});
t('G3.7', 'UNC/Linux/mnt 路径、IP 与常见 token 不穿透 public allowlist', () => {
  const cases = [
    ['\\\\server\\share\\secret.txt', /\[local-path\]/],
    ['/root/key', /\[local-path\]/],
    ['/mnt/c/Users/A/key', /\[local-path\]/],
    ['10.0.0.8', /\[ip\]/],
    ['sk-abcdefghijk', /\[token\]/],
    ['token=supersecret', /\[secret\]/]
  ];
  const bad = cases.filter(([raw, want]) => !want.test(redactOperationalText(raw)));
  return bad.length === 0 || JSON.stringify(bad.map(([raw]) => [raw, redactOperationalText(raw)]));
});

const pass = results.filter(r => r.ok).length;
console.log(`\n═══ 治理边界一致性验证（governance/0.1）═══\n`);
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.id.padEnd(6)} ${r.desc}`);
  if (!r.ok) console.log(`        └─ ${r.detail}`);
}
console.log(`\n判决：${pass}/${results.length} ${pass === results.length ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
process.exit(pass === results.length ? 0 : 1);
