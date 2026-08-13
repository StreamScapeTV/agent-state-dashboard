"use client";

interface DashboardClientProps {
  legacyProjects: string[];
}

export function DashboardClient({ legacyProjects }: DashboardClientProps) {
  return <div data-project-count={legacyProjects.length}>Dashboard type probe</div>;
}

/*
liveEventDecision(kind, payload)
const refreshFromEvent = () => applyLiveEvent("refresh")
const invalidateFromEvent = () => applyLiveEvent("invalidate")
applyLiveEvent("status", event.data)
events.onopen = () => applyLiveEvent("open")
events.onerror = () => applyLiveEvent("error")
const baseRows = useMemo(() => snapshot ? buildAgentRows(snapshot, 0) : [], [snapshot])
refreshAgentDurations(baseRows, nowMs)
const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null)
rows.find((row) => row.key === selectedAgentKey)
if (selectedAgentKey && !baseRows.some((row) => row.key === selectedAgentKey)) setSelectedAgentKey(null)
setSelectedAgentKey(row.key)
rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
<TablePagination
rowsPerPageOptions={[25, 50, 100]}
onClick={() => sort("attention")}
<CardActionArea
aria-pressed={selected}
aria-label="Clear filters"
event.key === "Enter" || event.key === " "
Next: {summary.nextAction}
*/
