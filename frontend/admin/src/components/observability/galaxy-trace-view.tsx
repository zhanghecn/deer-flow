import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { TraceRunDialog } from "./trace-run-dialog";
import { type TraceRunSummary } from "./trace-run-utils";

interface GalaxyTraceViewProps {
  runs: TraceRunSummary[];
  allRuns?: TraceRunSummary[];
  rootRunId?: string;
}

interface PositionedRun extends TraceRunSummary {
  position: [number, number, number];
}

interface LinkSegment {
  from: [number, number, number];
  to: [number, number, number];
}

function hashFloat(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

function truncateText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}...`;
}

function buildGraph(
  runs: TraceRunSummary[],
  rootRunId?: string,
): { nodes: PositionedRun[]; links: LinkSegment[] } {
  const grouped = new Map<number, TraceRunSummary[]>();
  for (const run of runs) {
    if (!grouped.has(run.depth)) grouped.set(run.depth, []);
    grouped.get(run.depth)?.push(run);
  }

  for (const [, list] of grouped) {
    list.sort((a, b) => {
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }

  const depths = [...grouped.keys()].sort((a, b) => a - b);
  const maxDepth = depths.length ? depths[depths.length - 1] : 0;
  const xGap = 4.8;
  const yGap = 5;
  const zSpread = 5.4;
  const nodes: PositionedRun[] = [];

  for (const depth of depths) {
    const list = grouped.get(depth) ?? [];
    const rootIndex = rootRunId ? list.findIndex((item) => item.runId === rootRunId) : -1;
    if (rootIndex > 0) {
      const [root] = list.splice(rootIndex, 1);
      list.unshift(root);
    }
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const x = (index - (list.length - 1) / 2) * xGap;
      const y = (maxDepth / 2 - depth) * yGap;
      const z = (hashFloat(item.runId) - 0.5) * zSpread;
      nodes.push({ ...item, position: [x, y, z] });
    }
  }

  const nodeMap = new Map(nodes.map((node) => [node.runId, node]));
  const links: LinkSegment[] = [];
  for (const node of nodes) {
    if (!node.parentRunId) continue;
    const parent = nodeMap.get(node.parentRunId);
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
        <bufferAttribute attach="attributes-position" args={[positionArray, 3]} />
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
        <bufferAttribute attach="attributes-position" args={[linkPositions, 3]} />
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
  selectedRunId,
  onSelect,
}: {
  nodes: PositionedRun[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const selected = node.runId === selectedRunId;
        const displayName = truncateText(node.label, 22);
        const displaySummary = truncateText(node.summary || t("Run details"), 52);
        return (
          <group key={node.runId} position={node.position}>
            <mesh
              onClick={(event) => {
                event.stopPropagation();
                onSelect(node.runId);
              }}
              onPointerOver={() => {
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "default";
              }}
            >
              <sphereGeometry args={[selected ? 0.36 : 0.26, 28, 28]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive={selected ? "#d9f7ff" : "#ffffff"}
                emissiveIntensity={selected ? 1.25 : 0.48}
                roughness={0.25}
                metalness={0.05}
              />
            </mesh>
            <mesh>
              <sphereGeometry args={[selected ? 0.92 : 0.66, 24, 24]} />
              <meshBasicMaterial
                color="#dff8ff"
                transparent
                opacity={selected ? 0.22 : 0.08}
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
                <p className="mt-0.5 text-slate-300">{displaySummary}</p>
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

export function GalaxyTraceView({
  runs,
  allRuns = runs,
  rootRunId,
}: GalaxyTraceViewProps) {
  const graph = useMemo(() => buildGraph(runs, rootRunId), [runs, rootRunId]);
  const nodeMap = useMemo(
    () => new Map(graph.nodes.map((node) => [node.runId, node])),
    [graph.nodes],
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    const root = graph.nodes.find((node) => node.runId === rootRunId);
    setSelectedRunId(root?.runId ?? graph.nodes[0]?.runId ?? null);
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
        {t("No run graph data")}
      </p>
    );
  }

  const selectedRun = selectedRunId ? nodeMap.get(selectedRunId) ?? null : null;

  return (
    <>
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
              selectedRunId={selectedRunId}
              onSelect={(runId) => {
                setSelectedRunId(runId);
                setIsDialogOpen(true);
              }}
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

        <div className="rounded-md border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
          {t("Click any node to open the full run payload. Hold Alt to pan.")}
          {selectedRun && (
            <span className="ml-2 text-foreground/80">
              {t("Selected: {label}", { label: selectedRun.label })}
            </span>
          )}
        </div>
      </div>

      <TraceRunDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        run={selectedRun}
        runs={allRuns}
      />
    </>
  );
}
