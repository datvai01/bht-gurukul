import { useState, useEffect, useCallback, Fragment } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { adminApi } from "@/lib/adminApi";
import {
  Shield, Search, Filter, Download, Trash2, ChevronLeft, ChevronRight,
  RefreshCw, X, Eye, AlertTriangle, Check, BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePortalSettings } from "@/admin/contexts/PortalSettingsContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuditEntry = {
  id: number;
  adminName: string;
  userRole: string | null;
  moduleName: string;
  actionType: string;
  entityName: string;
  entityId: string | null;
  previousValue: string | null;
  newValue: string | null;
  curriculumYear: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULES = [
  "All",
  "Student Registration",
  "Staff Management",
  "Course Management",
  "Inventory",
  "Communication Hub",
  "User Management",
  "Member Management",
  "Settings Management",
  "Academic Management",
  "Operations",
];

const ACTIONS = ["All", "Add", "Edit", "Delete", "Validate", "Status Change", "Config Update"];

const ROLES = [
  "All",
  "admin",
  "course_coordinator",
  "operations_manager",
  "teacher",
  "assistant",
];

const ROLE_LABELS: Record<string, string> = {
  admin:              "Gurukul Admin",
  course_coordinator: "Course Coordinator",
  operations_manager: "Operations Manager",
  teacher:            "Teacher",
  assistant:          "Assistant",
};

const ACTION_COLORS: Record<string, string> = {
  Add:           "bg-emerald-100 text-emerald-800 border border-emerald-200",
  Edit:          "bg-blue-100 text-blue-800 border border-blue-200",
  Delete:        "bg-red-100 text-red-800 border border-red-200",
  Validate:      "bg-violet-100 text-violet-800 border border-violet-200",
  "Status Change": "bg-amber-100 text-amber-800 border border-amber-200",
  "Config Update": "bg-cyan-100 text-cyan-800 border border-cyan-200",
};

const MODULE_BADGE_COLORS: Record<string, string> = {
  "Student Registration": "bg-orange-50 text-orange-700",
  "Staff Management":     "bg-purple-50 text-purple-700",
  "Communication Hub":    "bg-sky-50 text-sky-700",
  "Course Management":    "bg-amber-50 text-amber-700",
  "User Management":      "bg-rose-50 text-rose-700",
  "Member Management":    "bg-teal-50 text-teal-700",
  "Settings Management":  "bg-gray-100 text-gray-700",
  "Inventory":            "bg-lime-50 text-lime-700",
  "Academic Management":  "bg-indigo-50 text-indigo-700",
  "Operations":           "bg-fuchsia-50 text-fuchsia-700",
};

// Consistent color per known module; unknowns fall back to a rotation
const MODULE_COLORS: Record<string, string> = {
  "Student Registration": "#3b82f6",
  "User Management":      "#8b5cf6",
  "Course Management":    "#f59e0b",
  "Staff Management":     "#10b981",
  "Inventory":            "#f97316",
  "Communication Hub":    "#06b6d4",
  "Member Management":    "#f43f5e",
  "Settings Management":  "#64748b",
  "Academic Management":  "#6366f1",
  "Operations":           "#14b8a6",
};
const FALLBACK_COLORS = ["#a855f7","#84cc16","#e11d48","#0284c7","#d97706"];
function moduleColor(name: string, idx: number) {
  return MODULE_COLORS[name] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch { return iso; }
}

function safeJson(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ─── Detail view component ────────────────────────────────────────────────────

function DetailView({ entry }: { entry: AuditEntry }) {
  const prev = safeJson(entry.previousValue);
  const next = safeJson(entry.newValue);

  // For Edit actions with both values: show field-by-field diff table
  if (entry.actionType === "Edit" && prev && next) {
    const allKeys = [...new Set([...Object.keys(prev), ...Object.keys(next)])];
    const changed = allKeys.filter(k => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
    const unchanged = allKeys.filter(k => JSON.stringify(prev[k]) === JSON.stringify(next[k]));
    const displayKeys = [...changed, ...unchanged];

    return (
      <div className="space-y-3">
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider">Field</th>
                <th className="text-left px-3 py-2 font-semibold text-red-600 uppercase tracking-wider">Original Value</th>
                <th className="text-left px-3 py-2 font-semibold text-emerald-700 uppercase tracking-wider">Updated Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayKeys.map(k => {
                const isChanged = JSON.stringify(prev[k]) !== JSON.stringify(next[k]);
                return (
                  <tr key={k} className={isChanged ? "bg-yellow-50/60" : ""}>
                    <td className="px-3 py-2 font-mono text-secondary font-medium whitespace-nowrap">
                      {k}
                      {isChanged && <span className="ml-1.5 text-[10px] bg-yellow-200 text-yellow-800 rounded px-1">changed</span>}
                    </td>
                    <td className="px-3 py-2 text-red-700 max-w-[200px] break-all">{formatValue(prev[k])}</td>
                    <td className="px-3 py-2 text-emerald-700 max-w-[200px] break-all">{formatValue(next[k])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {entry.ipAddress && (
          <p className="text-[11px] text-muted-foreground">IP: {entry.ipAddress}</p>
        )}
      </div>
    );
  }

  // For Add: show new value only
  if (entry.actionType === "Add" && next) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Created Record</p>
        <div className="overflow-x-auto rounded-xl border border-emerald-100">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-emerald-50">
              {Object.entries(next).map(([k, v]) => (
                <tr key={k} className="bg-emerald-50/40">
                  <td className="px-3 py-1.5 font-mono text-secondary font-medium w-40">{k}</td>
                  <td className="px-3 py-1.5 text-emerald-800 break-all">{formatValue(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entry.ipAddress && <p className="text-[11px] text-muted-foreground">IP: {entry.ipAddress}</p>}
      </div>
    );
  }

  // For Delete / others: show previous value
  const data = prev || next;
  if (data) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {entry.actionType === "Delete" ? "Deleted Record" : "Record Value"}
        </p>
        <div className="overflow-x-auto rounded-xl border border-red-100">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-red-50">
              {Object.entries(data).map(([k, v]) => (
                <tr key={k} className="bg-red-50/30">
                  <td className="px-3 py-1.5 font-mono text-secondary font-medium w-40">{k}</td>
                  <td className="px-3 py-1.5 text-red-800 break-all">{formatValue(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entry.ipAddress && <p className="text-[11px] text-muted-foreground">IP: {entry.ipAddress}</p>}
      </div>
    );
  }

  // Fallback: raw text
  return (
    <div className="text-xs text-muted-foreground">
      {entry.previousValue && <pre className="whitespace-pre-wrap break-all">{entry.previousValue}</pre>}
      {entry.newValue      && <pre className="whitespace-pre-wrap break-all">{entry.newValue}</pre>}
    </div>
  );
}

// ─── Activity chart tooltip ───────────────────────────────────────────────────

function ActivityTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const active_bars = payload.filter((p: any) => p.value > 0);
  const total = active_bars.reduce((sum: number, p: any) => sum + (p.value as number), 0);
  return (
    <div className="bg-white border border-border rounded-xl shadow-lg p-3 text-xs min-w-[190px]">
      <p className="font-semibold text-secondary mb-2">{label} · {total} action{total !== 1 ? "s" : ""}</p>
      {[...active_bars].reverse().map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.fill }} />
            <span className="text-muted-foreground truncate">{p.dataKey}</span>
          </div>
          <span className="font-semibold text-secondary shrink-0">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const selectCls = "w-full rounded-lg border border-border px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-primary";

export default function AuditLog() {
  const { curriculumYearsLong } = usePortalSettings();

  const [entries,       setEntries]       = useState<AuditEntry[]>([]);
  const [total,         setTotal]         = useState(0);
  const [retentionDays, setRetentionDays] = useState(7);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);

  const [page,  setPage]  = useState(1);
  const [limit] = useState(100);

  // Filters
  const [filterModule,   setFilterModule]   = useState("All");
  const [filterAction,   setFilterAction]   = useState("All");
  const [filterRole,     setFilterRole]     = useState("All");
  const [filterUser,     setFilterUser]     = useState("All");
  const [filterCurrYear, setFilterCurrYear] = useState("All");
  const [filterFrom,     setFilterFrom]     = useState("");
  const [filterTo,       setFilterTo]       = useState("");
  const [search,         setSearch]         = useState("");
  const [searchInput,    setSearchInput]    = useState("");

  // Dropdown data
  const [users,        setUsers]        = useState<string[]>([]);
  const [activityData, setActivityData] = useState<{ modules: string[]; days: Array<Record<string, string | number>> } | null>(null);

  // UI state
  const [expanded,   setExpanded]   = useState<number | null>(null);
  const [showPurge,  setShowPurge]  = useState(false);
  const [purging,    setPurging]    = useState(false);
  const [purgeMsg,   setPurgeMsg]   = useState<string | null>(null);
  const [showChart,  setShowChart]  = useState(true);

  const buildParams = useCallback((): Record<string, string> => {
    const p: Record<string, string> = { page: String(page), limit: String(limit) };
    if (filterModule   !== "All") p.module         = filterModule;
    if (filterAction   !== "All") p.action         = filterAction;
    if (filterRole     !== "All") p.role           = filterRole;
    if (filterUser     !== "All") p.admin          = filterUser;
    if (filterCurrYear !== "All") p.curriculumYear = filterCurrYear;
    if (filterFrom)               p.dateFrom       = filterFrom;
    if (filterTo)                 p.dateTo         = filterTo;
    if (search.trim())            p.search         = search.trim();
    return p;
  }, [page, limit, filterModule, filterAction, filterRole, filterUser, filterCurrYear, filterFrom, filterTo, search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.audit.list(buildParams());
      setEntries(result.data as AuditEntry[]);
      setTotal(result.total);
      setRetentionDays(result.retentionDays);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    adminApi.audit.users().then(setUsers).catch(() => {});
    adminApi.audit.activity().then(setActivityData).catch(() => {});
  }, []);

  function handleSearch() { setSearch(searchInput); setPage(1); }

  function clearFilters() {
    setFilterModule("All");
    setFilterAction("All");
    setFilterRole("All");
    setFilterUser("All");
    setFilterCurrYear("All");
    setFilterFrom("");
    setFilterTo("");
    setSearch("");
    setSearchInput("");
    setPage(1);
  }

  const hasFilters =
    filterModule !== "All" || filterAction !== "All" || filterRole !== "All" ||
    filterUser !== "All" || filterCurrYear !== "All" ||
    filterFrom || filterTo || search;

  async function handlePurge() {
    setPurging(true);
    setPurgeMsg(null);
    try {
      const r = await adminApi.audit.purge();
      setPurgeMsg(`Purged ${r.deleted} record${r.deleted !== 1 ? "s" : ""} older than ${r.retentionDays} days.`);
      load();
    } catch (err: any) {
      setPurgeMsg(`Error: ${err?.message ?? "Failed to purge"}`);
    } finally {
      setPurging(false);
    }
  }

  function handleExport() {
    const params = buildParams();
    delete params.page;
    delete params.limit;
    window.open(adminApi.audit.exportUrl(params), "_blank");
  }

  const totalPages = Math.ceil(total / limit);
  const hasActivityData = activityData && activityData.modules.length > 0;

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-secondary flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Audit Log
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Immutable record of all admin actions · Retention: {retentionDays} days (max 15)
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <Button variant="outline" size="sm" onClick={() => setShowChart(v => !v)} className="gap-1.5">
            <BarChart2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{showChart ? "Hide" : "Show"} Chart</span>
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => { setShowPurge(true); setPurgeMsg(null); }}
            className="gap-1.5 text-red-600 hover:text-red-700 hover:border-red-300 hover:bg-red-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Purge Old</span>
          </Button>
        </div>
      </div>

      {/* ── 7-Day Feature Traffic Chart ─────────────────────────────────────── */}
      {showChart && (
        <div className="bg-white rounded-2xl border border-border p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-primary" />
              <span className="font-semibold text-secondary text-sm">Feature Traffic — Last 7 Days</span>
              {!hasActivityData && (
                <span className="text-xs text-muted-foreground ml-1">(no records in retention window)</span>
              )}
            </div>
            {hasActivityData && (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {activityData!.modules.map((mod, i) => (
                  <div key={mod} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: moduleColor(mod, i) }} />
                    {mod}
                  </div>
                ))}
              </div>
            )}
          </div>
          {hasActivityData ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={activityData!.days} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                <RechartsTooltip content={<ActivityTooltip />} cursor={{ fill: "rgba(99,102,241,0.06)" }} />
                {activityData!.modules.map((mod, i) => (
                  <Bar
                    key={mod}
                    dataKey={mod}
                    stackId="a"
                    fill={moduleColor(mod, i)}
                    maxBarSize={48}
                    radius={i === activityData!.modules.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[100px]">
              <div className="text-center">
                <BarChart2 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No activity data available yet</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-secondary">
          <Filter className="w-4 h-4 text-muted-foreground" />
          Filters
          {hasFilters && (
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500 transition-colors font-normal">
              <X className="w-3 h-3" /> Clear all
            </button>
          )}
        </div>

        {/* Row 1: Module | Action | Role | User */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Module</label>
            <select value={filterModule} onChange={e => { setFilterModule(e.target.value); setPage(1); }} className={selectCls}>
              {MODULES.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Action</label>
            <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(1); }} className={selectCls}>
              {ACTIONS.map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Role</label>
            <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setPage(1); }} className={selectCls}>
              {ROLES.map(r => (
                <option key={r} value={r}>
                  {r === "All" ? "All Roles" : (ROLE_LABELS[r] ?? r)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">User</label>
            <select value={filterUser} onChange={e => { setFilterUser(e.target.value); setPage(1); }} className={selectCls}>
              <option value="All">All Users</option>
              {users.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: Curriculum Year | From | To */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Curriculum Year</label>
            <select value={filterCurrYear} onChange={e => { setFilterCurrYear(e.target.value); setPage(1); }} className={selectCls}>
              <option value="All">All Years</option>
              {curriculumYearsLong.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">From Date</label>
            <Input type="date" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); setPage(1); }} className="h-[34px] text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">To Date</label>
            <Input type="date" value={filterTo} onChange={e => { setFilterTo(e.target.value); setPage(1); }} className="h-[34px] text-sm" />
          </div>
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <Input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Search by entity name or ID…"
            className="text-sm"
          />
          <Button size="sm" onClick={handleSearch} className="gap-1.5 shrink-0">
            <Search className="w-3.5 h-3.5" />
            Search
          </Button>
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* ── Stats row ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {loading ? "Loading…" : total === 0 ? "No records found" : (() => {
            const from = (page - 1) * limit + 1;
            const to   = Math.min(page * limit, total);
            return `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} record${total !== 1 ? "s" : ""}`;
          })()}
        </span>
        {totalPages > 1 && <span>Page {page} of {totalPages}</span>}
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading audit records…
          </div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center">
            <Shield className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground font-medium">No audit records found</p>
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-primary hover:underline mt-1">Clear filters</button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-gray-50">
                  {["Date / Time", "User", "Role", "Module", "Action", "Entity", "Curr. Year", "Details"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map(entry => (
                  <Fragment key={entry.id}>
                    <tr className="hover:bg-gray-50/70 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(entry.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-secondary text-xs">{entry.adminName}</span>
                      </td>
                      <td className="px-4 py-3">
                        {entry.userRole && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium whitespace-nowrap">
                            {ROLE_LABELS[entry.userRole] ?? entry.userRole}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-lg font-medium ${MODULE_BADGE_COLORS[entry.moduleName] ?? "bg-gray-100 text-gray-700"}`}>
                          {entry.moduleName}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${ACTION_COLORS[entry.actionType] ?? "bg-gray-100 text-gray-700 border border-gray-200"}`}>
                          {entry.actionType}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-secondary text-xs leading-tight">{entry.entityName}</div>
                        {entry.entityId && (
                          <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{entry.entityId}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {entry.curriculumYear ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {(entry.previousValue || entry.newValue) && (
                          <button
                            onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            {expanded === entry.id ? "Hide" : "View"}
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {expanded === entry.id && (
                      <tr className="bg-indigo-50/20">
                        <td colSpan={8} className="px-4 py-4">
                          <DetailView entry={entry} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="gap-1">
            <ChevronLeft className="w-4 h-4" /> Prev
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7)          pageNum = i + 1;
              else if (page <= 4)           pageNum = i + 1;
              else if (page >= totalPages - 3) pageNum = totalPages - 6 + i;
              else                          pageNum = page - 3 + i;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                    pageNum === page ? "bg-primary text-white" : "text-muted-foreground hover:bg-gray-100"
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="gap-1">
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* ── Purge Confirmation Modal ─────────────────────────────────────────── */}
      {showPurge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-secondary">Purge Old Audit Records</h3>
                <p className="text-xs text-muted-foreground">This action is permanent</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              This will permanently delete all audit log records older than{" "}
              <span className="font-semibold text-secondary">{retentionDays} days</span>.
              This cannot be undone. Recent records will be kept.
            </p>
            {purgeMsg && (
              <div className={`flex items-start gap-2 p-3 rounded-xl text-sm mb-4 ${
                purgeMsg.startsWith("Error")
                  ? "bg-red-50 border border-red-200 text-red-700"
                  : "bg-emerald-50 border border-emerald-200 text-emerald-700"
              }`}>
                {purgeMsg.startsWith("Error")
                  ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  : <Check className="w-4 h-4 shrink-0 mt-0.5" />}
                {purgeMsg}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setShowPurge(false); setPurgeMsg(null); }}>Cancel</Button>
              <Button
                onClick={handlePurge}
                disabled={purging}
                className="bg-red-600 hover:bg-red-700 text-white gap-2"
              >
                {purging ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {purging ? "Purging…" : "Purge Records"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
