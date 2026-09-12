export type ToolEffect = 'PURE' | 'ANALYSIS' | 'SIDE_EFFECTING';

export interface ToolPolicy {
  effect: ToolEffect;
  permission: string | null;
}

const TOOL_POLICIES: Record<string, ToolPolicy> = {
  'company.lookup': { effect: 'PURE', permission: null },
  'company.financials': { effect: 'PURE', permission: null },
  'due_diligence.run': { effect: 'PURE', permission: null },
  'investment_analysis.generate': { effect: 'ANALYSIS', permission: null },
  'ic.recommend': { effect: 'PURE', permission: null },
  'opportunity.advance_stage': { effect: 'SIDE_EFFECTING', permission: 'investment.opportunity.write' },
  'investment_decision.create': { effect: 'SIDE_EFFECTING', permission: 'investment.decision.write' },
};

export function getToolPolicy(toolName: string): ToolPolicy {
  const policy = TOOL_POLICIES[toolName];
  if (!policy) throw new Error(`Unknown investment tool: ${toolName}`);
  return policy;
}

export interface ToolAuthorization {
  authorize(toolName: string, permission: string, context: { tenantId: string; actorId: string; opportunityId?: string }): Promise<boolean>;
}

export async function requireToolPermission(
  toolName: string,
  context: { tenantId: string; actorId: string; opportunityId?: string },
  authorization?: ToolAuthorization,
): Promise<void> {
  const policy = getToolPolicy(toolName);
  if (policy.effect !== 'SIDE_EFFECTING') return;
  if (!authorization || !(await authorization.authorize(toolName, policy.permission!, context))) {
    throw new Error(`Tool permission denied: ${toolName}`);
  }
}
