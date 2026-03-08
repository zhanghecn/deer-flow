import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Badge } from "@/components/ui/badge";
import { formatAgo, maskString } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TraceEvent } from "@/types";
import { JsonMarkdownInspector } from "./json-markdown-inspector";

interface GalaxyTraceViewProps {
  events: TraceEvent[];
  rootRunId?: string;
}

type RunStatus = "running" | "completed" | "error";

interface RunNode {
  run_id: string;
  parent_run_id: string | null;
  run_type: string;
  status: RunStatus;
  node_name?: string;
  tool_name?: string;
  started_at?: string;
  finished_at?: string;
  event_count: number;
  total_tokens: number;
  start_payload?: Record<string, unknown>;
  end_payload?: Record<string, unknown>;
  short_params: string;
  depth: number;
}

interface PositionedRunNode extends RunNode {
  position: [number, number, number];
}

interface LinkSegment {
  from: [number, number, number];
  to: [number, number, number];
}

const STATUS_RANK: Record<RunStatus, number> = {
  completed: 1,
  running: 2,
  error: 3,
};

function toStatus(status: string | undefined): RunStatus {
  if (status === "error") return "error";
  if (status === "completed") return "completed";
  return "running";
}

function mergeStatus(current: RunStatus, next: RunStatus): RunStatus {
  return STATUS_RANK[next] > STATUS_RANK[current] ? next : current;
}

function resolveRunName(node: RunNode): string {
  if (node.tool_name) return node.tool_name;
  if (node.node_name) return node.node_name;
  return node.run_type;
}

function statusClass(status: RunStatus): string {
  if (status === "error") return "text-red-600 dark:text-red-400";
  if (status === "completed") return "text-emerald-600 dark:text-emerald-400";
  return "text-amber-600 dark:text-amber-400";
}

function hashFloat(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function truncateText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}...`;
}

function summarizeValue(value: unknown, depth = 0): string {
  if (depth > 3 || value == null) return "";
  if (typeof value === "string") {
    return truncateText(value, 54);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const head = summarizeValue(value[0], depth + 1);
    if (!head) return "[]";
    return value.length > 1 ? `[${head}, ...]` : `[${head}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).slice(0, 2);
    if (!entries.length) return "{}";
    const compact = entries
      .map(([key, item]) => `${key}:${summarizeValue(item, depth + 1)}`)
      .join(", ");
    return truncateText(compact, 62);
  }
  return "";
}

function summarizeMessages(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const lastMessage = messages[messages.length - 1];
  if (isRecord(lastMessage)) {
    const content = lastMessage.content ?? lastMessage.text ?? lastMessage.message;
    const summary = summarizeValue(content);
    if (summary) return summary;
  }
  return summarizeValue(lastMessage);
}

function extractCompactParams(node: RunNode): string {
  const start = node.start_payload;
  if (start) {
    const toolCall = isRecord(start.tool_call) ? start.tool_call : null;
    if (toolCall) {
      const summary = summarizeValue(
        toolCall.arguments ?? toolCall.inputs ?? start.inputs,
      );
      if (summary) return summary;
    }

    const inputSummary = summarizeValue(start.inputs);
    if (inputSummary) return inputSummary;

    const modelRequest = isRecord(start.model_request) ? start.model_request : null;
    if (modelRequest) {
      const messageSummary = summarizeMessages(modelRequest.messages);
      if (messageSummary) return messageSummary;
    }
  }

  const end = node.end_payload;
  if (end) {
    const toolResponse = isRecord(end.tool_response) ? end.tool_response : null;
    if (toolResponse) {
      const summary = summarizeValue(toolResponse.output ?? toolResponse);
      if (summary) return summary;
    }
    const outputSummary = summarizeValue(end.output);
    if (outputSummary) return outputSummary;
  }

  return "-";
}

function buildGraph(
  events: TraceEvent[],
  rootRunId?: string,
): { nodes: PositionedRunNode[]; links: LinkSegment[] } {
  const sortedEvents = [...events].sort((a, b) => a.event_index - b.event_index);
  const runMap = new Map<string, RunNode>();

  for (const evt of sortedEvents) {
    let node = runMap.get(evt.run_id);
    if (!node) {
      node = {
        run_id: evt.run_id,
        parent_run_id: evt.parent_run_id ?? null,
        run_type: evt.run_type,
        status: toStatus(evt.status),
        node_name: evt.node_name,
        tool_name: evt.tool_name,
        started_at: evt.started_at,
        finished_at: evt.finished_at,
        event_count: 0,
        total_tokens: 0,
        short_params: "-",
        depth: 0,
      };
      runMap.set(evt.run_id, node);
    }

    if (!node.parent_run_id && evt.parent_run_id) node.parent_run_id = evt.parent_run_id;
    if (!node.node_name && evt.node_name) node.node_name = evt.node_name;
    if (!node.tool_name && evt.tool_name) node.tool_name = evt.tool_name;
    if (!node.started_at && evt.started_at) node.started_at = evt.started_at;
    if (evt.finished_at) node.finished_at = evt.finished_at;
    node.status = mergeStatus(node.status, toStatus(evt.status));
    node.event_count += 1;
    node.total_tokens += evt.total_tokens ?? 0;

    if (evt.event_type === "start" && evt.payload) {
      node.start_payload = evt.payload;
    }
    if ((evt.event_type === "end" || evt.event_type === "error") && evt.payload) {
      node.end_payload = evt.payload;
    }
  }

  const depthCache = new Map<string, number>();

  function resolveDepth(runID: string, visited: Set<string>): number {
    if (depthCache.has(runID)) return depthCache.get(runID) ?? 0;
    if (visited.has(runID)) return 0;
    const node = runMap.get(runID);
    if (!node) return 0;
    if (rootRunId && runID === rootRunId) {
      depthCache.set(runID, 0);
      return 0;
    }
    if (!node.parent_run_id || !runMap.has(node.parent_run_id)) {
      depthCache.set(runID, 0);
      return 0;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(runID);
    const depth = resolveDepth(node.parent_run_id, nextVisited) + 1;
    depthCache.set(runID, depth);
    return depth;
  }

  for (const node of runMap.values()) {
    node.depth = resolveDepth(node.run_id, new Set());
    node.short_params = extractCompactParams(node);
  }

  const grouped = new Map<number, RunNode[]>();
  for (const node of runMap.values()) {
    if (!grouped.has(node.depth)) grouped.set(node.depth, []);
    grouped.get(node.depth)?.push(node);
  }

  for (const [, list] of grouped) {
    list.sort((a, b) => {
      const aTime = a.started_at ? new Date(a.started_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.started_at ? new Date(b.started_at).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }

  const depths = [...grouped.keys()].sort((a, b) => a - b);
  const maxDepth = depths.length ? depths[depths.length - 1] : 0;
  const xGap = 4.6;
  const yGap = 4.9;
  const zSpread = 4.8;
  const nodes: PositionedRunNode[] = [];

  for (const depth of depths) {
    const list = grouped.get(depth) ?? [];
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const x = (index - (list.length - 1) / 2) * xGap;
      const y = (maxDepth / 2 - depth) * yGap;
      const z = (hashFloat(item.run_id) - 0.5) * zSpread;
      nodes.push({ ...item, position: [x, y, z] });
    }
  }

  const nodeMap = new Map(nodes.map((node) => [node.run_id, node]));
  const links: LinkSegment[] = [];
  for (const node of nodes) {
    if (!node.parent_run_id) continue;
    const parent = nodeMap.get(node.parent_run_id);
    if (!parent) continue;
    links.push({ from: parent.position, to: node.position });
  }

  return { nodes, links };
}

function Starfield({ count = 1600, radius = 88 }: { count?: number; radius?: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const positionArray = useMemo(() => {
    const values = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const r = radius * (0.45 + Math.random() * 0.55);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      values[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      values[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      values[i * 3 + 2] = r * Math.cos(phi);
    }
    return values;
  }, [count, radius]);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y += delta * 0.008;
    pointsRef.current.rotation.x += delta * 0.002;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positionArray, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#ffffff"
        size={0.16}
        sizeAttenuation
        transparent
        opacity={0.72}
      />
    </points>
  );
}

function LinkLines({ links }: { links: LinkSegment[] }) {
  const materialRef = useRef<THREE.LineBasicMaterial>(null);
  const linkPositions = useMemo(() => {
    const values = new Float32Array(links.length * 6);
    links.forEach((link, index) => {
      values[index * 6 + 0] = link.from[0];
      values[index * 6 + 1] = link.from[1];
      values[index * 6 + 2] = link.from[2];
      values[index * 6 + 3] = link.to[0];
      values[index * 6 + 4] = link.to[1];
      values[index * 6 + 5] = link.to[2];
    });
    return values;
  }, [links]);

  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    materialRef.current.opacity = 0.16 + (Math.sin(clock.elapsedTime * 1.9) + 1) * 0.09;
  });

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[linkPositions, 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial
        ref={materialRef}
        color="#a7f3ff"
        transparent
        opacity={0.2}
      />
    </lineSegments>
  );
}

function NodeStars({
  nodes,
  selectedRunID,
  onSelect,
}: {
  nodes: PositionedRunNode[];
  selectedRunID: string | null;
  onSelect: (runID: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const selected = node.run_id === selectedRunID;
        const displayName = truncateText(resolveRunName(node), 20);
        const displayParams = truncateText(node.short_params, 46);
        return (
          <group key={node.run_id} position={node.position}>
            <mesh
              onClick={(event) => {
                event.stopPropagation();
                onSelect(node.run_id);
              }}
              onPointerOver={() => {
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "default";
              }}
            >
              <sphereGeometry args={[selected ? 0.34 : 0.24, 28, 28]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive={selected ? "#d9f7ff" : "#ffffff"}
                emissiveIntensity={selected ? 1.25 : 0.48}
                roughness={0.25}
                metalness={0.05}
              />
            </mesh>
            <mesh>
              <sphereGeometry args={[selected ? 0.88 : 0.62, 24, 24]} />
              <meshBasicMaterial
                color="#dff8ff"
                transparent
                opacity={selected ? 0.2 : 0.08}
              />
            </mesh>
            <Html
              center
              position={[0, selected ? 1.18 : 0.96, 0]}
              distanceFactor={10}
              style={{ pointerEvents: "none" }}
            >
              <div
                className={cn(
                  "rounded-md border px-2 py-1.5 text-[10px] leading-tight",
                  "bg-slate-900/80 text-slate-100 border-slate-200/25 backdrop-blur-sm shadow-lg",
                  selected && "border-cyan-200/70 bg-slate-900/90",
                )}
              >
                <p className="font-semibold">{displayName}</p>
                <p className="mt-0.5 text-slate-300">{displayParams}</p>
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

export function GalaxyTraceView({ events, rootRunId }: GalaxyTraceViewProps) {
  const graph = useMemo(() => buildGraph(events, rootRunId), [events, rootRunId]);
  const [selectedRunID, setSelectedRunID] = useState<string | null>(null);
  const [isAltPressed, setIsAltPressed] = useState(false);

  useEffect(() => {
    const root = graph.nodes.find((node) => node.run_id === rootRunId);
    setSelectedRunID(root?.run_id ?? graph.nodes[0]?.run_id ?? null);
  }, [graph.nodes, rootRunId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) {
        setIsAltPressed(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!event.altKey || event.key === "Alt") {
        setIsAltPressed(false);
      }
    };
    const onWindowBlur = () => {
      setIsAltPressed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  if (!graph.nodes.length) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No run graph data
      </p>
    );
  }

  const nodeMap = new Map(graph.nodes.map((node) => [node.run_id, node]));
  const selected = selectedRunID ? nodeMap.get(selectedRunID) ?? null : null;

  return (
    <div className="space-y-3">
      <div className="h-[540px] rounded-xl border overflow-hidden bg-slate-950">
        <Canvas camera={{ position: [0, 0, 26], fov: 52 }}>
          <color attach="background" args={["#020617"]} />
          <fog attach="fog" args={["#020617", 30, 96]} />
          <ambientLight intensity={0.35} />
          <pointLight position={[0, 0, 0]} intensity={0.9} color="#d8f5ff" />
          <pointLight position={[0, 12, 8]} intensity={0.45} color="#ffffff" />

          <Starfield />
          <LinkLines links={graph.links} />
          <NodeStars
            nodes={graph.nodes}
            selectedRunID={selectedRunID}
            onSelect={setSelectedRunID}
          />

          <OrbitControls
            enablePan
            minDistance={10}
            maxDistance={46}
            maxPolarAngle={Math.PI * 0.9}
            minPolarAngle={Math.PI * 0.1}
            target={[0, 0, 0]}
            mouseButtons={
              isAltPressed
                ? {
                    LEFT: THREE.MOUSE.PAN,
                    MIDDLE: THREE.MOUSE.DOLLY,
                    RIGHT: THREE.MOUSE.PAN,
                  }
                : {
                    LEFT: THREE.MOUSE.ROTATE,
                    MIDDLE: THREE.MOUSE.DOLLY,
                    RIGHT: THREE.MOUSE.PAN,
                  }
            }
          />
        </Canvas>
      </div>

      {selected && (
        <div className="rounded-md border bg-background/70 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{selected.run_type}</Badge>
            <Badge variant="secondary">{selected.status}</Badge>
            <span className="text-sm font-medium">{resolveRunName(selected)}</span>
          </div>
          <div className="grid md:grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>
              Run: <span className="font-mono">{maskString(selected.run_id, 8, 6)}</span>
            </div>
            <div>
              Parent:{" "}
              <span className="font-mono">
                {selected.parent_run_id
                  ? maskString(selected.parent_run_id, 8, 6)
                  : "-"}
              </span>
            </div>
            <div>Events: {selected.event_count}</div>
            <div>Tokens: {selected.total_tokens}</div>
            <div className={cn(statusClass(selected.status))}>Status: {selected.status}</div>
            <div>Started: {formatAgo(selected.started_at)}</div>
          </div>

          {selected.start_payload && (
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Start Payload
              </p>
              <JsonMarkdownInspector value={selected.start_payload} />
            </div>
          )}

          {selected.end_payload && (
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                End Payload
              </p>
              <JsonMarkdownInspector value={selected.end_payload} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
