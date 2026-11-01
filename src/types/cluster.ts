declare const percentBrand: unique symbol;

/** 闭区间 [0, 100] 上的百分比。 */
export type Percent = number & { readonly [percentBrand]: "Percent" };

/** 机架编号，只允许 0、1、2。 */
export type RackIndex = 0 | 1 | 2;

/** 最近 6 个时间点的用量序列，每个点都在 [0, 100]。 */
export type MetricHistory = readonly [
  Percent,
  Percent,
  Percent,
  Percent,
  Percent,
  Percent,
];

export type PodStatus =
  | "Running"
  | "Pending"
  | "CrashLoopBackOff"
  | "OOMKilled"
  | "Terminating";

export type NodeStatus = "Ready" | "HighLoad" | "NetworkPartition";

export type ChaosScenario =
  | "NONE"
  | "POD_OOM_SWARM"
  | "NODE_CPU_SPIKE"
  | "NET_PACKET_LOSS";

export type AlertSeverity = "P0" | "P1" | "P2";

export interface PodEntity {
  id: string;
  name: string;
  namespace: string;
  nodeId: string;
  status: PodStatus;
  cpuUsage: Percent;
  memoryUsage: Percent;
  restarts: number;
  ip: string;
  createdAt: string;
  cpuHistory: MetricHistory;
  memHistory: MetricHistory;
}

export interface WorkerNodeEntity {
  id: string;
  name: string;
  ip: string;
  status: NodeStatus;
  cpuCapacity: number;
  memCapacity: number;
  networkMbps: number;
  rackIndex: RackIndex;
  podIds: string[];
}

/** 控制面 Master。不进入 Worker 机架，也不承载业务 Pod。 */
export interface MasterMetadata {
  id: string;
  name: string;
  role: "control-plane";
  ip: string;
  apiServer: string;
  description: string;
}

/** 快照中的一条活跃告警。生成式卡片见 RootCauseAlertProps。 */
export interface AlertEvent {
  id: string;
  severity: AlertSeverity;
  summary: string;
  podId: string | null;
  nodeId: string | null;
  scenario: ChaosScenario;
  timestamp: string;
}

export interface TelemetrySnapshot {
  timestamp: string;
  clusterHealthScore: Percent;
  totalQps: number;
  master: MasterMetadata;
  nodes: WorkerNodeEntity[];
  pods: PodEntity[];
  activeAlerts: AlertEvent[];
}

export function toPercent(value: number): Percent {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`Percent must be within [0, 100], received ${value}`);
  }
  return value as Percent;
}

export function toRackIndex(value: number): RackIndex {
  if (value === 0 || value === 1 || value === 2) {
    return value;
  }
  throw new RangeError(`RackIndex must be 0, 1, or 2, received ${value}`);
}

export function toMetricHistory(samples: readonly number[]): MetricHistory {
  if (samples.length !== 6) {
    throw new RangeError(
      `MetricHistory requires 6 samples, received ${samples.length}`,
    );
  }
  return [
    toPercent(samples[0]),
    toPercent(samples[1]),
    toPercent(samples[2]),
    toPercent(samples[3]),
    toPercent(samples[4]),
    toPercent(samples[5]),
  ];
}

const SNAPSHOT_AT = "2026-11-01T02:58:00.000Z";

function trail(current: number, step: number): MetricHistory {
  return toMetricHistory(
    [5, 4, 3, 2, 1, 0].map((index) =>
      Math.min(100, Math.max(0, Math.round(current - step * index))),
    ),
  );
}

function seedPod(
  name: string,
  namespace: string,
  nodeId: string,
  status: PodStatus,
  cpuUsage: number,
  memoryUsage: number,
  restarts: number,
  ip: string,
  createdAt: string,
  cpuStep: number,
  memStep: number,
): PodEntity {
  return {
    id: name,
    name,
    namespace,
    nodeId,
    status,
    cpuUsage: toPercent(cpuUsage),
    memoryUsage: toPercent(memoryUsage),
    restarts,
    ip,
    createdAt,
    cpuHistory: trail(cpuUsage, cpuStep),
    memHistory: trail(memoryUsage, memStep),
  };
}

const INITIAL_PODS: PodEntity[] = [
  seedPod("payment-gateway-7f8b9-x2k", "payments", "worker-alpha", "Running", 38, 46, 0, "10.244.1.11", "2026-10-28T01:12:00.000Z", 2, 1),
  seedPod("payment-gateway-7f8b9-m4q", "payments", "worker-alpha", "Running", 41, 44, 0, "10.244.1.12", "2026-10-28T01:12:08.000Z", 1, 2),
  seedPod("checkout-api-6c2d1-h8n", "checkout", "worker-alpha", "Running", 22, 31, 1, "10.244.1.21", "2026-10-29T06:40:00.000Z", 3, 1),
  seedPod("checkout-api-6c2d1-p3v", "checkout", "worker-alpha", "Running", 27, 29, 0, "10.244.1.22", "2026-10-29T06:40:06.000Z", 2, 2),
  seedPod("ledger-writer-9aa21-k7s", "payments", "worker-alpha", "Running", 55, 62, 0, "10.244.1.31", "2026-10-27T11:05:00.000Z", 4, 2),
  seedPod("fraud-detector-4e10c-b2r", "risk", "worker-alpha", "Running", 63, 48, 2, "10.244.1.41", "2026-10-30T03:18:00.000Z", 3, 1),
  seedPod("webhook-dispatcher-2d77a-q9c", "checkout", "worker-alpha", "Pending", 4, 12, 0, "10.244.1.51", "2026-11-01T02:51:00.000Z", 1, 1),
  seedPod("pci-vault-sidecar-8b31f-t6w", "payments", "worker-alpha", "Running", 11, 22, 0, "10.244.1.61", "2026-10-26T09:22:00.000Z", 1, 2),
  seedPod("redis-shard-0", "data", "worker-beta", "Running", 72, 81, 0, "10.244.2.10", "2026-10-20T04:00:00.000Z", 2, 1),
  seedPod("redis-shard-1", "data", "worker-beta", "Running", 68, 77, 0, "10.244.2.11", "2026-10-20T04:00:04.000Z", 3, 2),
  seedPod("redis-shard-2", "data", "worker-beta", "Running", 74, 84, 1, "10.244.2.12", "2026-10-20T04:00:08.000Z", 2, 1),
  seedPod("kafka-broker-0", "streaming", "worker-beta", "Running", 81, 70, 0, "10.244.2.20", "2026-10-21T08:30:00.000Z", 4, 2),
  seedPod("kafka-broker-1", "streaming", "worker-beta", "Running", 77, 66, 0, "10.244.2.21", "2026-10-21T08:30:05.000Z", 3, 1),
  seedPod("order-projector-5f90e-a1d", "checkout", "worker-beta", "Running", 58, 49, 1, "10.244.2.30", "2026-10-29T14:11:00.000Z", 5, 2),
  seedPod("inventory-cache-3c88b-z4p", "catalog", "worker-beta", "Running", 44, 91, 0, "10.244.2.40", "2026-10-25T02:44:00.000Z", 2, 1),
  seedPod("search-indexer-1ab40-n5y", "catalog", "worker-beta", "OOMKilled", 96, 99, 7, "10.244.2.41", "2026-10-31T19:06:00.000Z", 6, 1),
  seedPod("identity-api-8d21c-r4m", "identity", "worker-gamma", "Running", 18, 24, 0, "10.244.3.11", "2026-10-24T07:15:00.000Z", 2, 1),
  seedPod("identity-api-8d21c-w7j", "identity", "worker-gamma", "Running", 21, 26, 0, "10.244.3.12", "2026-10-24T07:15:07.000Z", 1, 2),
  seedPod("otel-collector-0", "observability", "worker-gamma", "Running", 33, 41, 0, "10.244.3.20", "2026-10-22T12:00:00.000Z", 2, 1),
  seedPod("prometheus-0", "observability", "worker-gamma", "Running", 47, 73, 0, "10.244.3.21", "2026-10-22T12:00:03.000Z", 3, 2),
  seedPod("grafana-renderer-6e44d-h2l", "observability", "worker-gamma", "Running", 15, 28, 1, "10.244.3.22", "2026-10-28T16:42:00.000Z", 2, 1),
  seedPod("ingress-nginx-controller-7c9f2-s8p", "ingress-nginx", "worker-gamma", "Running", 29, 34, 0, "10.244.3.30", "2026-10-23T05:28:00.000Z", 1, 1),
  seedPod("cert-manager-6a12b-d3k", "cert-manager", "worker-gamma", "CrashLoopBackOff", 8, 19, 14, "10.244.3.31", "2026-10-31T22:17:00.000Z", 1, 2),
  seedPod("feature-flag-relay-9f30a-c5t", "platform", "worker-gamma", "Terminating", 12, 17, 0, "10.244.3.40", "2026-10-18T10:03:00.000Z", 2, 1),
];

function podIdsOn(nodeId: string): string[] {
  return INITIAL_PODS.filter((pod) => pod.nodeId === nodeId).map((pod) => pod.id);
}

/** 首屏 SSR 与画布使用的静态集群快照。混沌注入尚未开始。 */
export const INITIAL_CLUSTER_SNAPSHOT: TelemetrySnapshot = {
  timestamp: SNAPSHOT_AT,
  clusterHealthScore: toPercent(78),
  totalQps: 2360,
  master: {
    id: "master-0",
    name: "control-plane-a",
    role: "control-plane",
    ip: "10.0.0.10",
    apiServer: "https://10.0.0.10:6443",
    description:
      "控制面 Master。kube-apiserver、etcd 与 scheduler 不进入三台 Worker 机架，也不承载业务 Pod；首屏只把它作为集群元数据说明。",
  },
  nodes: [
    {
      id: "worker-alpha",
      name: "worker-alpha",
      ip: "10.0.1.11",
      status: "Ready",
      cpuCapacity: 16,
      memCapacity: 64,
      networkMbps: 10000,
      rackIndex: toRackIndex(0),
      podIds: podIdsOn("worker-alpha"),
    },
    {
      id: "worker-beta",
      name: "worker-beta",
      ip: "10.0.1.12",
      status: "HighLoad",
      cpuCapacity: 32,
      memCapacity: 128,
      networkMbps: 25000,
      rackIndex: toRackIndex(1),
      podIds: podIdsOn("worker-beta"),
    },
    {
      id: "worker-gamma",
      name: "worker-gamma",
      ip: "10.0.1.13",
      status: "Ready",
      cpuCapacity: 16,
      memCapacity: 64,
      networkMbps: 10000,
      rackIndex: toRackIndex(2),
      podIds: podIdsOn("worker-gamma"),
    },
  ],
  pods: INITIAL_PODS,
  activeAlerts: [
    {
      id: "alert-search-indexer-oom",
      severity: "P1",
      summary: "search-indexer-1ab40-n5y 因内存触顶被 OOMKilled，已重启 7 次。",
      podId: "search-indexer-1ab40-n5y",
      nodeId: "worker-beta",
      scenario: "POD_OOM_SWARM",
      timestamp: "2026-11-01T02:47:12.000Z",
    },
    {
      id: "alert-worker-beta-cpu",
      severity: "P2",
      summary: "worker-beta 承载 redis 与 kafka，CPU 持续处于 HighLoad。",
      podId: null,
      nodeId: "worker-beta",
      scenario: "NODE_CPU_SPIKE",
      timestamp: "2026-11-01T02:40:00.000Z",
    },
    {
      id: "alert-cert-manager-crashloop",
      severity: "P2",
      summary: "cert-manager-6a12b-d3k 陷入 CrashLoopBackOff，证书签发暂停。",
      podId: "cert-manager-6a12b-d3k",
      nodeId: "worker-gamma",
      scenario: "NONE",
      timestamp: "2026-11-01T02:33:40.000Z",
    },
  ],
};
