"use client";

import {
  INITIAL_CLUSTER_SNAPSHOT,
  type TelemetrySnapshot,
} from "@/types/cluster";

/** 渲染循环只许写这份引用，不许把它放进 React state。 */
export interface TelemetryTransient {
  snapshot: TelemetrySnapshot;
  podCpuFloat32: Float32Array;
  podMemFloat32: Float32Array;
  nodeNetFloat32: Float32Array;
  currentFps: number;
}

function cloneSnapshot(snapshot: TelemetrySnapshot): TelemetrySnapshot {
  return structuredClone(snapshot) as TelemetrySnapshot;
}

function fillBuffer(values: ArrayLike<number>): Float32Array {
  const buffer = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    buffer[index] = values[index] ?? 0;
  }
  return buffer;
}

function writeBuffer(current: Float32Array, values: ArrayLike<number>): Float32Array {
  if (current.length !== values.length) {
    return fillBuffer(values);
  }
  for (let index = 0; index < values.length; index += 1) {
    current[index] = values[index] ?? 0;
  }
  return current;
}

function targetsFromSnapshot(snapshot: TelemetrySnapshot): Pick<
  TelemetryTransient,
  "podCpuFloat32" | "podMemFloat32" | "nodeNetFloat32"
> {
  return {
    podCpuFloat32: fillBuffer(snapshot.pods.map((pod) => pod.cpuUsage)),
    podMemFloat32: fillBuffer(snapshot.pods.map((pod) => pod.memoryUsage)),
    nodeNetFloat32: fillBuffer(snapshot.nodes.map((node) => node.networkMbps)),
  };
}

const initialSnapshot = cloneSnapshot(INITIAL_CLUSTER_SNAPSHOT);

/** 全局单例。下标与 snapshot.pods / snapshot.nodes 的顺序一致。 */
export const telemetryTransientRef: TelemetryTransient = {
  snapshot: initialSnapshot,
  ...targetsFromSnapshot(initialSnapshot),
  currentFps: 0,
};

export function readTelemetryTransient(): TelemetryTransient {
  return telemetryTransientRef;
}

export function readTelemetrySnapshot(): TelemetrySnapshot {
  return telemetryTransientRef.snapshot;
}

export function writeTelemetrySnapshot(snapshot: TelemetrySnapshot): void {
  const next = cloneSnapshot(snapshot);
  telemetryTransientRef.snapshot = next;
  telemetryTransientRef.podCpuFloat32 = writeBuffer(
    telemetryTransientRef.podCpuFloat32,
    next.pods.map((pod) => pod.cpuUsage),
  );
  telemetryTransientRef.podMemFloat32 = writeBuffer(
    telemetryTransientRef.podMemFloat32,
    next.pods.map((pod) => pod.memoryUsage),
  );
  telemetryTransientRef.nodeNetFloat32 = writeBuffer(
    telemetryTransientRef.nodeNetFloat32,
    next.nodes.map((node) => node.networkMbps),
  );
}

/** 写入每个 Pod 的 CPU / 内存插值目标，不替换调用方已经持有的数组引用（长度不变时）。 */
export function writePodFloatTargets(
  cpu: ArrayLike<number>,
  memory: ArrayLike<number>,
): void {
  telemetryTransientRef.podCpuFloat32 = writeBuffer(
    telemetryTransientRef.podCpuFloat32,
    cpu,
  );
  telemetryTransientRef.podMemFloat32 = writeBuffer(
    telemetryTransientRef.podMemFloat32,
    memory,
  );
}

/** 写入每台 Worker 的网络吞吐目标，单位 Mbps。 */
export function writeNodeNetRates(rates: ArrayLike<number>): void {
  telemetryTransientRef.nodeNetFloat32 = writeBuffer(
    telemetryTransientRef.nodeNetFloat32,
    rates,
  );
}

export function writeCurrentFps(fps: number): void {
  telemetryTransientRef.currentFps = Number.isFinite(fps) ? fps : 0;
}
