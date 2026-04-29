import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Play, GripVertical, Zap, CheckCircle2, Monitor } from "lucide-react";
import { toast } from "sonner";
import { getSocket } from "../lib/socket";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useFlow, useUpdateFlow, useTriggerWave } from "../hooks/useFlows";
import { useQueryClient } from "@tanstack/react-query";
import { usePermission } from "../hooks/usePermission";
import { StatusBadge } from "../components/ui/StatusBadge";
import { WaveDto } from "@autopack/shared";

function DeviceProgressBar({ progress }: {
  progress?: { installed: number; failed: number; pending: number; total: number; percentComplete: number };
}) {
  if (!progress || progress.total === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span className="flex items-center gap-1"><Monitor className="w-3 h-3" /> Device installs</span>
        <span>{progress.installed}/{progress.total} ({progress.percentComplete}%)</span>
      </div>
      <div className="h-1.5 bg-surface rounded-full overflow-hidden flex">
        <div className="bg-green-500 h-full transition-all" style={{ width: `${(progress.installed / progress.total) * 100}%` }} />
        <div className="bg-red-500 h-full transition-all" style={{ width: `${(progress.failed / progress.total) * 100}%` }} />
      </div>
      <div className="flex gap-3 text-xs text-text-muted">
        <span className="text-green-400">✓ {progress.installed} installed</span>
        {progress.failed > 0 && <span className="text-red-400">✗ {progress.failed} failed</span>}
        {progress.pending > 0 && <span className="text-yellow-400">⋯ {progress.pending} pending</span>}
      </div>
    </div>
  );
}

function SortableWaveCard({
  wave,
  canTrigger,
  onTrigger,
  deviceProgress,
}: {
  wave: WaveDto;
  canTrigger: boolean;
  onTrigger: (waveId: string) => void;
  deviceProgress?: { installed: number; failed: number; pending: number; total: number; percentComplete: number };
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: wave.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="space-y-1">
    <div
      className={`flex items-center gap-4 p-4 bg-surface-2 border rounded-xl transition-colors ${
        isDragging ? "border-primary/50 shadow-lg shadow-primary/20" : "border-border"
      }`}
    >
      <button {...attributes} {...listeners} className="text-text-muted hover:text-text cursor-grab active:cursor-grabbing">
        <GripVertical className="w-4 h-4" />
      </button>

      <div className="w-7 h-7 rounded-full bg-border flex items-center justify-center text-xs font-bold text-text-muted">
        {wave.order}
      </div>

      <div className="flex-1">
        <p className="font-medium text-text">{wave.name}</p>
        <p className="text-xs font-mono text-text-muted">{wave.groupId}</p>
      </div>

      <div className="text-xs text-text-muted">
        {wave.delayHours > 0 ? `${wave.delayHours}h delay` : "No delay"}
      </div>

      <StatusBadge status={wave.status} />

      {canTrigger && wave.status !== "completed" && (
        <button
          onClick={() => onTrigger(wave.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary text-xs rounded-lg transition-colors"
        >
          <Play className="w-3 h-3" />
          Deploy
        </button>
      )}
      {wave.status === "completed" && (
        <CheckCircle2 className="w-5 h-5 text-green-400" />
      )}
    </div>
    <DeviceProgressBar progress={deviceProgress} />
    </div>
  );
}

export function FlowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canManage = usePermission("FLOW_MANAGE");
  const canDeploy = usePermission("DEPLOYMENT_TRIGGER");
  const { data: flow, isLoading } = useFlow(id);
  const updateFlow = useUpdateFlow();
  const triggerWave = useTriggerWave();
  const [waves, setWaves] = useState<WaveDto[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const queryClient = useQueryClient();

  // Device install progress keyed by waveId
  const [deviceProgress, setDeviceProgress] = useState<Record<string, {
    installed: number; failed: number; pending: number; total: number; percentComplete: number;
  }>>({});

  useEffect(() => {
    const socket = getSocket();
    const handler = (p: any) => {
      setDeviceProgress((prev) => ({
        ...prev,
        [p.waveId]: {
          installed: p.installed,
          failed: p.failed,
          pending: p.pending,
          total: p.total,
          percentComplete: p.percentComplete,
        },
      }));
    };
    socket.on("deployment:device-progress", handler);
    return () => { socket.off("deployment:device-progress", handler); };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (flow?.waves) {
      setWaves([...(flow.waves as WaveDto[])].sort((a, b) => a.order - b.order));
    }
  }, [flow?.waves]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = waves.findIndex((w) => w.id === active.id);
    const newIndex = waves.findIndex((w) => w.id === over.id);
    const reordered = arrayMove(waves, oldIndex, newIndex).map((w, i) => ({ ...w, order: i + 1 }));
    setWaves(reordered);
    setHasChanges(true);
  }

  async function saveWaveOrder() {
    if (!id) return;
    try {
      await updateFlow.mutateAsync({ id, waves });
      toast.success("Wave order saved");
      setHasChanges(false);
    } catch {
      toast.error("Failed to save");
    }
  }

  async function handleTriggerWave(waveId: string) {
    if (!id) return;
    let jobId: string | undefined;
    try {
      const result = await triggerWave.mutateAsync({ flowId: id, waveId });
      jobId = result.jobId;
      toast.loading("Deploying to Intune...", { id: `deploy-${waveId}` });
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? "Trigger failed");
      return;
    }

    // Stream real deployment progress
    const socket = getSocket();
    const handler = (p: { jobId: string; status: string; message: string; percent: number }) => {
      if (p.jobId !== jobId) return;
      if (p.status === "completed") {
        toast.success(p.message, { id: `deploy-${waveId}` });
        socket.off("deployment:progress", handler);
        queryClient.invalidateQueries({ queryKey: ["flow", id] });
      } else if (p.status === "failed") {
        toast.error(p.message, { id: `deploy-${waveId}` });
        socket.off("deployment:progress", handler);
        queryClient.invalidateQueries({ queryKey: ["flow", id] });
      } else {
        toast.loading(p.message, { id: `deploy-${waveId}` });
      }
    };
    socket.on("deployment:progress", handler);
  }

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-surface rounded w-1/3" />
        <div className="h-48 bg-surface rounded-xl" />
      </div>
    );
  }

  if (!flow) return <div className="text-text-muted">Flow not found</div>;

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <button onClick={() => navigate("/flows")} className="flex items-center gap-2 text-text-muted hover:text-text text-sm">
        <ArrowLeft className="w-4 h-4" />
        Back to Flows
      </button>

      {/* Flow header */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text">{flow.name}</h1>
            <p className="text-text-muted mt-1">{flow.app?.name} — {flow.app?.publisher}</p>
          </div>
          <div className="flex items-center gap-2">
            {flow.autoUpdate && (
              <span className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-1 rounded-full">
                <Zap className="w-3 h-3" />
                Auto-update ON
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Wave builder */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide">
            Deployment Waves
          </h2>
          {canManage && hasChanges && (
            <button
              onClick={saveWaveOrder}
              disabled={updateFlow.isPending}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm rounded-lg transition-colors disabled:opacity-60"
            >
              {updateFlow.isPending ? "Saving..." : "Save Order"}
            </button>
          )}
        </div>

        {canManage ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={waves.map((w) => w.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {waves.map((wave) => (
                  <SortableWaveCard
                    key={wave.id}
                    wave={wave}
                    canTrigger={canDeploy}
                    onTrigger={handleTriggerWave}
                    deviceProgress={deviceProgress[wave.id]}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="space-y-3">
            {waves.map((wave) => (
              <div key={wave.id} className="flex items-center gap-4 p-4 bg-surface-2 border border-border rounded-xl">
                <div className="w-7 h-7 rounded-full bg-border flex items-center justify-center text-xs font-bold text-text-muted">
                  {wave.order}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-text">{wave.name}</p>
                  <p className="text-xs font-mono text-text-muted">{wave.groupId}</p>
                </div>
                <StatusBadge status={wave.status} />
                {canDeploy && wave.status !== "completed" && (
                  <button
                    onClick={() => handleTriggerWave(wave.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary text-xs rounded-lg transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    Deploy
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {canManage && (
          <p className="text-xs text-text-muted mt-3 text-center">
            Drag waves to reorder deployment sequence
          </p>
        )}
      </div>
    </div>
  );
}
