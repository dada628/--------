import type {
  AlertSeverity,
  MetricHistory,
  Percent,
  PodStatus,
} from "@/types/cluster";

declare const unitIntervalBrand: unique symbol;
declare const millisecondsBrand: unique symbol;

/** 闭区间 [0, 1] 上的置信度。 */
export type UnitInterval = number & { readonly [unitIntervalBrand]: "UnitInterval" };

/** 非负推理耗时，单位毫秒。 */
export type Milliseconds = number & { readonly [millisecondsBrand]: "Milliseconds" };

export type CopilotActionType = "restart_pod" | "scale_deployment" | "drain_node";

export type ActionExecutionStatus =
  | "awaiting_confirmation"
  | "executing"
  | "succeeded"
  | "failed"
  | "rejected";

export type AuditLabel =
  | "CRITICAL_PANIC"
  | "RESOURCE_EXHAUSTED"
  | "NETWORK_TIMEOUT"
  | "NORMAL_INFO";

export interface PodMetricsCardProps {
  podId: string;
  name: string;
  namespace: string;
  status: PodStatus;
  cpuUsage: Percent;
  memoryUsage: Percent;
  cpuHistory: MetricHistory;
  memHistory: MetricHistory;
  restarts: number;
}

export interface EvidenceLink {
  id: string;
  source: string;
  detail: string;
  timestamp: string;
}

export interface RecommendedAction {
  actionType: CopilotActionType;
  targetId: string;
  label: string;
}

export interface RootCauseAlertProps {
  severity: AlertSeverity;
  rootCauseSummary: string;
  evidenceChain: EvidenceLink[];
  recommendedActions: RecommendedAction[];
}

export interface ActionConfirmProps {
  actionType: CopilotActionType;
  targetId: string;
  executionStatus: ActionExecutionStatus;
}

export interface PodLogSource {
  podId: string;
  podName: string;
  namespace: string;
}

export interface LogEntry {
  rawText: string;
  redactedText: string;
  timestamp: string;
  source: PodLogSource;
}

export interface EdgeAuditResult {
  label: AuditLabel;
  confidence: UnitInterval;
  inferenceTimeMs: Milliseconds;
}

export function toUnitInterval(value: number): UnitInterval {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`UnitInterval must be within [0, 1], received ${value}`);
  }
  return value as UnitInterval;
}

export function toMilliseconds(value: number): Milliseconds {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Milliseconds must be >= 0, received ${value}`);
  }
  return value as Milliseconds;
}
