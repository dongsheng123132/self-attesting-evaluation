// policy.mjs — task.origin 的最小治理与披露边界
//
// 关键取舍：旧学历没有完整治理元数据时，不猜它属于哪个客户，也不因目录相邻就共享。
// 它仍可被自己的任务读取，但跨任务上下文与对外导出一律 fail-closed。
export const VISIBILITY = new Set(['private', 'project', 'public']);
export const SENSITIVITY = new Set(['public', 'internal', 'confidential', 'restricted']);
export const CONTEXT_ACCESS = new Set(['task', 'project', 'global']);
export const EXPORT_POLICY = new Set(['deny', 'redacted', 'allow']);

const REQUIRED = [
  'tenant_id', 'project_id', 'visibility', 'sensitivity',
  'context_access', 'export_policy', 'retention_days'
];

const text = v => typeof v === 'string' ? v.trim() : '';

/**
 * 把治理元数据规范成一个可判定对象。
 * classified=false 不是“随便共享”的兼容模式，而是“仅本任务可见、禁止导出”的隔离模式。
 */
export function normalizeGovernance(state = {}) {
  const raw = state?.governance;
  const taskRef = text(state.id) || 'unknown';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      classified: false,
      tenant_id: `isolated:${taskRef}`,
      project_id: `isolated:${taskRef}`,
      visibility: 'private', sensitivity: 'restricted',
      context_access: 'task', export_policy: 'deny', retention_days: 0,
      reason: 'missing_governance'
    };
  }

  const missing = REQUIRED.filter(k => raw[k] === undefined || raw[k] === null || raw[k] === '');
  const invalid = [];
  if (!VISIBILITY.has(raw.visibility)) invalid.push('visibility');
  if (!SENSITIVITY.has(raw.sensitivity)) invalid.push('sensitivity');
  if (!CONTEXT_ACCESS.has(raw.context_access)) invalid.push('context_access');
  if (!EXPORT_POLICY.has(raw.export_policy)) invalid.push('export_policy');
  if (!Number.isInteger(raw.retention_days) || raw.retention_days < 0) invalid.push('retention_days');
  if (missing.length || invalid.length || !text(raw.tenant_id) || !text(raw.project_id)) {
    return {
      classified: false,
      tenant_id: `isolated:${taskRef}`,
      project_id: `isolated:${taskRef}`,
      visibility: 'private', sensitivity: 'restricted',
      context_access: 'task', export_policy: 'deny', retention_days: 0,
      reason: 'invalid_governance', missing, invalid
    };
  }

  return {
    classified: true,
    tenant_id: text(raw.tenant_id), project_id: text(raw.project_id),
    visibility: raw.visibility, sensitivity: raw.sensitivity,
    context_access: raw.context_access, export_policy: raw.export_policy,
    retention_days: raw.retention_days
  };
}

/** 返回可行动的问题；空数组才表示治理声明内部自洽。 */
export function governanceIssues(state = {}) {
  const g = normalizeGovernance(state);
  if (!g.classified) return [{ code: g.reason, message: '治理元数据缺失或无效：按仅本任务可见、禁止导出处理' }];
  const out = [];
  if (g.visibility === 'private' && g.context_access !== 'task')
    out.push({ code: 'private_context', message: 'visibility=private 只能 context_access=task' });
  if (g.visibility === 'private' && g.export_policy !== 'deny')
    out.push({ code: 'private_export', message: 'visibility=private 必须 export_policy=deny' });
  if (g.sensitivity === 'restricted' && g.context_access !== 'task')
    out.push({ code: 'restricted_context', message: 'sensitivity=restricted 只能 context_access=task' });
  if (g.sensitivity === 'restricted' && g.export_policy !== 'deny')
    out.push({ code: 'restricted_export', message: 'sensitivity=restricted 必须 export_policy=deny' });
  if (g.context_access === 'global' && (g.visibility !== 'public' || g.sensitivity !== 'public'))
    out.push({ code: 'unsafe_global', message: '全局上下文必须同时 visibility=public、sensitivity=public' });
  if (g.export_policy === 'allow' && (g.visibility !== 'public' || g.sensitivity !== 'public'))
    out.push({ code: 'unsafe_export', message: '完整发布必须同时 visibility=public、sensitivity=public' });
  return out;
}

/** source 是否可进入 target 的上下文。source===target 始终允许读取自己的状态。 */
export function canShareContext(source, target) {
  if (source === target) return true;
  const s = normalizeGovernance(source), t = normalizeGovernance(target);
  if (!s.classified || !t.classified) return false;
  if (governanceIssues(source).length || governanceIssues(target).length) return false;
  if (s.context_access === 'task' || s.visibility === 'private' || s.sensitivity === 'restricted') return false;
  if (s.context_access === 'project') {
    return s.tenant_id === t.tenant_id && s.project_id === t.project_id
      && (s.visibility === 'project' || s.visibility === 'public');
  }
  return s.context_access === 'global' && s.visibility === 'public' && s.sensitivity === 'public';
}

/** 只处理能可靠识别的操作性标识；人名不能靠正则假装脱敏。 */
export function redactOperationalText(value) {
  return String(value ?? '')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[token]')
    .replace(/\b(api[_-]?key|token|secret)\s*[:=]\s*[^\s,，;；]+/gi, '$1=[secret]')
    .replace(/\\\\[^\\\s]+\\[^\r\n,，;；)）\]]+/g, '[local-path]')
    .replace(/(?:[A-Za-z]:[\\/]|\/mnt\/[A-Za-z]\/)[^\r\n,，;；)）\]]+/g, '[local-path]')
    .replace(/\/(Users|home|root|var|tmp)\/[^\r\n,，;；)）\]]+/g, '[local-path]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]');
}

const countsOf = state => ({
  facts: (state.facts || []).length,
  verified_facts: (state.facts || []).filter(f => f.verified).length,
  decisions: (state.decisions || []).length,
  actions: (state.actions || []).length,
  artifacts: (state.artifacts || []).length,
  learnings: (state.learnings || []).length,
  next_steps: (state.next_steps || []).length
});

/**
 * 构造唯一允许对外发布的对象。返回 {ok,status,document?}，不直接写盘。
 * redacted 只给结构统计；allow 也走字段 allowlist，永不原样复制 actor/session_id/绝对产物路径。
 */
export function buildPublishableExport(state = {}) {
  const g = normalizeGovernance(state);
  const issues = governanceIssues(state);
  if (!g.classified || issues.length) return { ok: false, status: 'denied', reason: issues[0]?.code || g.reason };
  if (g.export_policy === 'deny') return { ok: false, status: 'denied', reason: 'export_policy_deny' };

  const base = {
    spec: 'shadowos.publishable-state/0.1',
    mode: g.export_policy,
    governance: {
      visibility: g.visibility, sensitivity: g.sensitivity,
      export_policy: g.export_policy, retention_days: g.retention_days
    },
    counts: countsOf(state)
  };

  if (g.export_policy === 'redacted') {
    return { ok: true, status: 'redacted', document: {
      ...base,
      disclosure: 'counts_only',
      note: '仅披露结构计数与治理级别；不提供可用于关联客户、项目或任务的标识符'
    } };
  }

  // governanceIssues 已保证 allow 只能用于 public/public；这里仍使用 allowlist，不 raw spread。
  const clean = redactOperationalText;
  return { ok: true, status: 'allow', document: {
    ...base,
    disclosure: 'allowlisted_public_content',
    title: clean(state.title), goal: clean(state.goal), current_state: clean(state.current_state),
    facts: (state.facts || []).filter(f => f.verified).map(f => ({
      claim: clean(f.claim), verified: true,
      source: clean(f.source), source_kind: f.source_kind || undefined
    })),
    decisions: (state.decisions || []).map(d => ({ what: clean(d.what), why: clean(d.why) })),
    verification: clean(state.verification),
    next_steps: (state.next_steps || []).map(clean),
    learnings: (state.learnings || []).filter(l => l.status === 'verified')
      .map(l => ({ lesson: clean(l.lesson), status: 'verified' })),
    actor: state.actor && typeof state.actor === 'object'
      ? { harness: clean(state.actor.harness), model: clean(state.actor.model) } : undefined
  } };
}
