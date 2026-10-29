// A scheduled task's page on the 定时任务 page (Claude cfc18e0f4 Xe EpitaxyLocalRoutineDetail under
// c9e1458cd's header; not-found and load-failed as c9e1458cd ds).
//
// Props (Scheduled.tsx renders it inside the page column, keyed by the task):
// - `task`: the route's { id, source }; "cloud" belongs to the cloud phase and reads as not found here.
// The page leaves with patchScheduled({ task: null }) and opens the form with
// patchScheduled({ dialog: { type: "form", source, id, seed: null } }); Scheduled.tsx names the window
// and the titlebar's 定时任务 › name from the task's name.
//
// First version: the way back, the name and the instructions.

import { patchScheduled } from "../lib/codex";
import { useAutomations } from "../lib/automations";
import { Button, Icon, Spinner } from "./ui";

export interface ScheduledDetailProps {
  task: { id: string; source: "local" | "cloud" };
}

export function ScheduledDetail({ task }: ScheduledDetailProps) {
  const item = useAutomations((s) => (task.source === "local" ? s.items?.find((a) => a.id === task.id) : undefined));
  const loading = useAutomations((s) => s.items === null && !s.error);
  const back = () => patchScheduled({ task: null });
  if (!item)
    return loading ? (
      <div className="plugins-empty" aria-busy="true">
        <Spinner size={16} label="正在加载定时任务" />
      </div>
    ) : (
      <div className="plugins-empty">
        <p className="plugins-empty-title">找不到此定时任务</p>
        <Button variant="secondary" size="sm" onClick={back}>
          所有定时任务
        </Button>
      </div>
    );
  return (
    <>
      <div className="plugins-hero">
        <Button variant="ghost" icon={<Icon name="ArrowLeft" />} label="所有定时任务" onClick={back} />
        <h2 className="plugins-title">{item.name}</h2>
      </div>
      <section className="plugins-section">
        <h3 className="plugins-section-title">
          <span className="plugins-section-name">指令</span>
        </h3>
        <p className="plugins-note scheduled-text">{item.prompt}</p>
      </section>
    </>
  );
}
