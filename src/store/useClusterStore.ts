"use client";

import { create } from "zustand";
import type { CopilotActionType } from "@/types/ai";
import {
  toMetricHistory,
  toPercent,
  type ChaosScenario,
  type MasterMetadata,
  type MetricHistory,
  type Percent,
  type PodEntity,
  type PodStatus,
  type TelemetrySnapshot,
  type WorkerNodeEntity,
} from "@/types/cluster";
import {
  readTelemetrySnapshot,
  writeTelemetrySnapshot,
  telemetryTransientRef,
} from "@/store/useTelemetryRef";

export const TELEMETRY_SUMMARY_INTERVAL_MS = 1000;
const TERMINAL_LOG_LIMIT = 200;

export type ConnectionMode = "demo" | "live";
export type SelectedEntityType = "master" | "node" | "pod";
export type StatusFilter = PodStatus | "ALL";

/** HUD 持有的选中实体拷贝。后续快照突变不会改到这份对象。 */
export interface HudEntitySnapshot {
  entityType: SelectedEntityType;
  entityId: string;
  master: MasterMetadata | null;
  node: WorkerNodeEntity | null;
  pod: PodEntity | null;
}

interface ClusterState {
  selectedEntityId: string | null;
  selectedEntityType: SelectedEntityType | null;
  connectionMode: ConnectionMode;
  activeChaos: ChaosScenario;
  statusFilter: StatusFilter;
  isChaosModalOpen: boolean;
  isPerfHudOpen: boolean;
  terminalLogs: string[];
  quickPromptTrigger: string | null;
  healthScore: Percent;
  abnormalPodCount: number;
  currentFps: number;
  selectedEntitySnapshot: HudEntitySnapshot | null;
}

interface ClusterActions {
  selectEntity: (id: string, entityType: SelectedEntityType) => void;
  clearSelection: () => void;
  setConnectionMode: (mode: ConnectionMode) => void;
  toggleConnectionMode: () => void;
  triggerChaos: (scenario: ChaosScenario) => void;
  healEntity: (targetId: string, actionType: string) => void;
  appendTerminalLog: (line: string) => void;
  triggerQuickPrompt: (prompt: string) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setChaosModalOpen: (open: boolean) => void;
  setPerfHudOpen: (open: boolean) => void;
}

export type ClusterStore = ClusterState & ClusterActions;

const HEALED_CPU_MAX = 32;
const SELF_HEAL_LOG = "[KUBE-CONTROLLER] Successfully executed self-healing action";

function stamp(message: string): string {
  return `${new Date().toISOString()}  ${message}`;
}

function boundLogs(logs: string[]): string[] {
  return logs.length > TERMINAL_LOG_LIMIT
    ? logs.slice(logs.length - TERMINAL_LOG_LIMIT)
    : logs;
}

function pushLog(logs: string[], message: string): string[] {
  return boundLogs([...logs, stamp(message)]);
}

function pushGreenSelfHealLog(logs: string[]): string[] {
  const line = `\u001b[32m${new Date().toISOString()}  ${SELF_HEAL_LOG}\u001b[0m`;
  return boundLogs([...logs, line]);
}

function countAbnormalPods(snapshot: TelemetrySnapshot): number {
  return snapshot.pods.filter((pod) => pod.status !== "Running").length;
}

function scoreSnapshot(snapshot: TelemetrySnapshot, chaos: ChaosScenario): Percent {
  const abnormal = countAbnormalPods(snapshot);
  const stressed = snapshot.nodes.filter((node) => node.status !== "Ready").length;
  const chaosPenalty = chaos === "NONE" ? 0 : 8;
  return toPercent(
    Math.max(0, Math.min(100, 100 - abnormal * 5 - stressed * 4 - chaosPenalty)),
  );
}

function rollHistory(history: MetricHistory, nextValue: number): MetricHistory {
  return toMetricHistory([
    history[1],
    history[2],
    history[3],
    history[4],
    history[5],
    nextValue,
  ]);
}

function captureSelection(
  snapshot: TelemetrySnapshot,
  entityId: string | null,
  entityType: SelectedEntityType | null,
): HudEntitySnapshot | null {
  if (!entityId || !entityType) return null;
  if (entityType === "master" && snapshot.master.id === entityId) {
    return {
      entityType,
      entityId,
      master: structuredClone(snapshot.master),
      node: null,
      pod: null,
    };
  }
  if (entityType === "node") {
    const node = snapshot.nodes.find((item) => item.id === entityId);
    if (!node) return null;
    return {
      entityType,
      entityId,
      master: null,
      node: structuredClone(node),
      pod: null,
    };
  }
  const pod = snapshot.pods.find((item) => item.id === entityId);
  if (!pod) return null;
  return {
    entityType,
    entityId,
    master: null,
    node: null,
    pod: structuredClone(pod),
  };
}

function selectionSignature(snapshot: HudEntitySnapshot | null): string {
  if (!snapshot) return "";
  const pod = snapshot.pod;
  const node = snapshot.node;
  return [
    snapshot.entityType,
    snapshot.entityId,
    pod?.status ?? "",
    pod?.cpuUsage ?? "",
    pod?.memoryUsage ?? "",
    node?.status ?? "",
    snapshot.master?.id ?? "",
  ].join("|");
}

function workloadPrefix(name: string): string {
  const parts = name.split("-");
  const tail = parts[parts.length - 1] ?? "";
  const hash = parts[parts.length - 2] ?? "";
  if (parts.length >= 3 && /^\d+$/.test(tail)) {
    return parts.slice(0, -1).join("-");
  }
  if (parts.length >= 3 && /^[a-z0-9]+$/.test(tail) && /^[a-z0-9]+$/.test(hash)) {
    return parts.slice(0, -2).join("-");
  }
  return name;
}

function isCopilotAction(value: string): value is CopilotActionType {
  return (
    value === "restart_pod" ||
    value === "scale_deployment" ||
    value === "drain_node"
  );
}

function healPod(pod: PodEntity): PodEntity {
  const cpu = Math.min(pod.cpuUsage, HEALED_CPU_MAX);
  const memory = pod.status === "OOMKilled" || pod.memoryUsage > 85 ? 48 : pod.memoryUsage;
  return {
    ...pod,
    status: "Running",
    cpuUsage: toPercent(cpu),
    memoryUsage: toPercent(memory),
    cpuHistory: rollHistory(pod.cpuHistory, cpu),
    memHistory: rollHistory(pod.memHistory, memory),
  };
}

function podIdsForHeal(
  snapshot: TelemetrySnapshot,
  targetId: string,
  actionType: string,
): string[] {
  const pod = snapshot.pods.find((item) => item.id === targetId);
  const node = snapshot.nodes.find((item) => item.id === targetId);
  if (actionType === "drain_node") {
    const nodeId = node?.id ?? pod?.nodeId;
    if (!nodeId) return [];
    return snapshot.pods
      .filter((item) => item.nodeId === nodeId)
      .map((item) => item.id);
  }
  if (actionType === "scale_deployment") {
    const sourceName = pod?.name ?? targetId;
    const prefix = workloadPrefix(sourceName);
    return snapshot.pods
      .filter((item) => item.name === prefix || item.name.startsWith(`${prefix}-`))
      .map((item) => item.id);
  }
  if (pod) return [pod.id];
  if (node) {
    return snapshot.pods.filter((item) => item.nodeId === node.id).map((item) => item.id);
  }
  return [];
}

function applyHeal(
  snapshot: TelemetrySnapshot,
  targetIds: ReadonlySet<string>,
  chaos: ChaosScenario,
): TelemetrySnapshot {
  const pods = snapshot.pods.map((pod) =>
    targetIds.has(pod.id) ? healPod(pod) : pod,
  );
  const nodes = snapshot.nodes.map((node) => {
    const stillAbnormal = pods.some(
      (pod) => pod.nodeId === node.id && pod.status !== "Running",
    );
    if (stillAbnormal || node.status === "Ready") return node;
    return { ...node, status: "Ready" as const };
  });
  const healedNodes = new Set(
    nodes.filter((node) => node.status === "Ready").map((node) => node.id),
  );
  const activeAlerts = snapshot.activeAlerts.filter((alert) => {
    if (alert.podId && targetIds.has(alert.podId)) return false;
    if (!alert.podId && alert.nodeId && healedNodes.has(alert.nodeId)) return false;
    return true;
  });
  const healed = { ...snapshot, pods, nodes, activeAlerts };
  return {
    ...healed,
    timestamp: new Date().toISOString(),
    clusterHealthScore: scoreSnapshot(healed, chaos),
  };
}

function applyChaos(
  snapshot: TelemetrySnapshot,
  scenario: ChaosScenario,
): TelemetrySnapshot {
  if (scenario === "NONE") {
    const nodes = snapshot.nodes.map((node) =>
      node.status === "Ready" ? node : { ...node, status: "Ready" as const },
    );
    const cleared = {
      ...snapshot,
      nodes,
      activeAlerts: snapshot.activeAlerts.filter((alert) => alert.scenario === "NONE"),
    };
    return {
      ...cleared,
      timestamp: new Date().toISOString(),
      clusterHealthScore: scoreSnapshot(cleared, "NONE"),
    };
  }

  let pods = snapshot.pods;
  let nodes = snapshot.nodes;
  let summary = "";
  let podId: string | null = null;
  let nodeId: string | null = null;

  if (scenario === "POD_OOM_SWARM") {
    let remaining = 4;
    pods = snapshot.pods.map((pod) => {
      if (pod.status !== "Running" || remaining <= 0) return pod;
      remaining -= 1;
      podId = pod.id;
      return {
        ...pod,
        status: "OOMKilled" as const,
        memoryUsage: toPercent(99),
        memHistory: rollHistory(pod.memHistory, 99),
      };
    });
    summary = "混沌 POD_OOM_SWARM：4 个 Running Pod 被标记为 OOMKilled。";
  } else if (scenario === "NODE_CPU_SPIKE") {
    nodeId = "worker-beta";
    nodes = snapshot.nodes.map((node) =>
      node.id === nodeId ? { ...node, status: "HighLoad" as const } : node,
    );
    pods = snapshot.pods.map((pod) => {
      if (pod.nodeId !== nodeId || pod.status !== "Running") return pod;
      const cpu = Math.min(100, pod.cpuUsage + 24);
      return {
        ...pod,
        cpuUsage: toPercent(cpu),
        cpuHistory: rollHistory(pod.cpuHistory, cpu),
      };
    });
    summary = "混沌 NODE_CPU_SPIKE：worker-beta 进入 HighLoad。";
  } else {
    nodeId = "worker-gamma";
    nodes = snapshot.nodes.map((node) =>
      node.id === nodeId ? { ...node, status: "NetworkPartition" as const } : node,
    );
    summary = "混沌 NET_PACKET_LOSS：worker-gamma 进入 NetworkPartition。";
  }

  const stamped = new Date().toISOString();
  const next: TelemetrySnapshot = {
    ...snapshot,
    timestamp: stamped,
    pods,
    nodes,
    activeAlerts: [
      {
        id: `alert-${scenario}-${stamped}`,
        severity: scenario === "POD_OOM_SWARM" ? "P0" : "P1",
        summary,
        podId,
        nodeId,
        scenario,
        timestamp: stamped,
      },
      ...snapshot.activeAlerts,
    ],
    clusterHealthScore: snapshot.clusterHealthScore,
  };
  return {
    ...next,
    clusterHealthScore: scoreSnapshot(next, scenario),
  };
}

const seed = readTelemetrySnapshot();

export const useClusterStore = create<ClusterStore>((set, get) => ({
  selectedEntityId: null,
  selectedEntityType: null,
  connectionMode: "demo",
  activeChaos: "NONE",
  statusFilter: "ALL",
  isChaosModalOpen: false,
  isPerfHudOpen: false,
  terminalLogs: [stamp("seed loaded: control-plane-a + 3 workers + 24 pods")],
  quickPromptTrigger: null,
  healthScore: seed.clusterHealthScore,
  abnormalPodCount: countAbnormalPods(seed),
  currentFps: 0,
  selectedEntitySnapshot: null,

  selectEntity: (id, entityType) => {
    const snapshot = readTelemetrySnapshot();
    set({
      selectedEntityId: id,
      selectedEntityType: entityType,
      selectedEntitySnapshot: captureSelection(snapshot, id, entityType),
    });
    get().appendTerminalLog(`select ${entityType} ${id}`);
  },

  clearSelection: () => {
    set({
      selectedEntityId: null,
      selectedEntityType: null,
      selectedEntitySnapshot: null,
    });
  },

  setConnectionMode: (mode) => {
    set({ connectionMode: mode });
    get().appendTerminalLog(`connection mode ${mode}`);
  },

  toggleConnectionMode: () => {
    const next = get().connectionMode === "demo" ? "live" : "demo";
    get().setConnectionMode(next);
  },

  triggerChaos: (scenario) => {
    const next = applyChaos(readTelemetrySnapshot(), scenario);
    writeTelemetrySnapshot(next);
    set({
      activeChaos: scenario,
      healthScore: next.clusterHealthScore,
      abnormalPodCount: countAbnormalPods(next),
      selectedEntitySnapshot: captureSelection(
        next,
        get().selectedEntityId,
        get().selectedEntityType,
      ),
    });
    get().appendTerminalLog(
      scenario === "NONE" ? "chaos cleared" : `chaos armed ${scenario}`,
    );
    flushTelemetrySummary(true);
  },

  healEntity: (targetId, actionType) => {
    const current = readTelemetrySnapshot();
    const ids = podIdsForHeal(current, targetId, actionType);
    const actionLabel = isCopilotAction(actionType) ? actionType : `custom:${actionType}`;
    if (ids.length === 0) {
      get().appendTerminalLog(`heal skipped ${actionLabel} ${targetId}`);
      return;
    }
    const chaos = get().activeChaos;
    const next = applyHeal(current, new Set(ids), chaos);
    writeTelemetrySnapshot(next);
    const syncedSnapshot = readTelemetrySnapshot();
    const synced = ids.every((id) => {
      const index = syncedSnapshot.pods.findIndex((pod) => pod.id === id);
      const pod = syncedSnapshot.pods[index];
      const cpuTarget = telemetryTransientRef.podCpuFloat32[index];
      return (
        index >= 0 &&
        pod?.status === "Running" &&
        pod.cpuUsage < 35 &&
        cpuTarget !== undefined &&
        cpuTarget < 35
      );
    });
    if (!synced) {
      get().appendTerminalLog(`heal failed to sync transient ref ${actionLabel} ${targetId}`);
      return;
    }
    set((state) => ({
      healthScore: next.clusterHealthScore,
      abnormalPodCount: countAbnormalPods(next),
      selectedEntitySnapshot: captureSelection(
        next,
        state.selectedEntityId,
        state.selectedEntityType,
      ),
      terminalLogs: pushGreenSelfHealLog(state.terminalLogs),
    }));
    flushTelemetrySummary(true);
  },

  appendTerminalLog: (line) => {
    set((state) => ({ terminalLogs: pushLog(state.terminalLogs, line) }));
  },

  triggerQuickPrompt: (prompt) => {
    const text = prompt.trim();
    if (!text) return;
    set({ quickPromptTrigger: null });
    set((state) => ({
      quickPromptTrigger: text,
      terminalLogs: pushLog(state.terminalLogs, `quick prompt ${text}`),
    }));
  },

  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setChaosModalOpen: (open) => set({ isChaosModalOpen: open }),
  setPerfHudOpen: (open) => set({ isPerfHudOpen: open }),
}));

let lastSummaryCommit = 0;

/** 每 1000ms 最多把瞬态引用里的摘要写入 store 一次。渲染循环不要调用它。 */
export function flushTelemetrySummary(force = false): void {
  const now = Date.now();
  if (!force && now - lastSummaryCommit < TELEMETRY_SUMMARY_INTERVAL_MS) return;
  lastSummaryCommit = now;

  const snapshot = telemetryTransientRef.snapshot;
  const state = useClusterStore.getState();
  const healthScore = snapshot.clusterHealthScore;
  const abnormalPodCount = countAbnormalPods(snapshot);
  const currentFps = Math.round(telemetryTransientRef.currentFps);
  const selectedEntitySnapshot = captureSelection(
    snapshot,
    state.selectedEntityId,
    state.selectedEntityType,
  );
  const selectionChanged =
    selectionSignature(state.selectedEntitySnapshot) !==
    selectionSignature(selectedEntitySnapshot);

  if (
    state.healthScore === healthScore &&
    state.abnormalPodCount === abnormalPodCount &&
    state.currentFps === currentFps &&
    !selectionChanged
  ) {
    return;
  }

  useClusterStore.setState({
    healthScore,
    abnormalPodCount,
    currentFps,
    selectedEntitySnapshot: selectionChanged
      ? selectedEntitySnapshot
      : state.selectedEntitySnapshot,
  });
}

function bootTelemetrySummaryClock(): void {
  if (typeof window === "undefined") return;
  const scope = globalThis as typeof globalThis & {
    __cyberSandboxSummaryClock?: number;
  };
  if (scope.__cyberSandboxSummaryClock !== undefined) return;
  scope.__cyberSandboxSummaryClock = window.setInterval(() => {
    flushTelemetrySummary(false);
  }, TELEMETRY_SUMMARY_INTERVAL_MS);
}

bootTelemetrySummaryClock();
