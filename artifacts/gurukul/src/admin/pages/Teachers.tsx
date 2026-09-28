import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { adminApi } from "@/lib/adminApi";
import { validatePersonName, validateEmail, validateUSPhone, formatUSPhone } from "@/lib/validators";
import {
  Plus, Edit2, Trash2, Check, X, Search, Phone, Mail, Loader2, BookOpen, UserCheck, KeyRound, Eye, EyeOff, Clock,
  CalendarDays, Printer, Users, LayoutList as ScheduleIcon,
  Filter, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortalSettings } from "@/admin/contexts/PortalSettingsContext";

type Assignment = {
  sectionId:   number | null;
  sectionName: string | null;
  schedule:    string | null;
  levelName:   string | null;
  courseName:  string | null;
  role:        string;
};

// ─── Schedule helpers ─────────────────────────────────────────────────────────

type CalEvent = {
  id: string; teacherName: string; courseName: string;
  sectionName: string; levelName: string; day: string;
  startMin: number; endMin: number;
};

const DAY_RE: [RegExp, string][] = [
  [/saturdays?/i, "Sat"], [/sundays?/i, "Sun"], [/mondays?/i, "Mon"],
  [/tuesdays?/i,  "Tue"], [/wednesdays?/i,"Wed"],[/thursdays?/i,"Thu"],[/fridays?/i,"Fri"],
];

function parseMin(h: string, m: string, p: string): number {
  let hr = parseInt(h); const min = parseInt(m);
  if (p.toUpperCase() === "PM" && hr !== 12) hr += 12;
  if (p.toUpperCase() === "AM" && hr === 12) hr = 0;
  return hr * 60 + min;
}

function buildCalEvents(teachers: Teacher[]): CalEvent[] {
  const events: CalEvent[] = [];
  for (const t of teachers.filter(t => t.status === "Active")) {
    t.assignments.forEach((a, idx) => {
      if (!a.schedule) return;
      const m = a.schedule.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–\-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!m) return;
      let day = "—";
      for (const [re, label] of DAY_RE) { if (re.test(a.schedule!)) { day = label; break; } }
      events.push({
        id: `${t.id}-${idx}`, teacherName: t.name,
        courseName: a.courseName ?? "Unknown", sectionName: a.sectionName ?? "",
        levelName: a.levelName ?? "", day,
        startMin: parseMin(m[1], m[2], m[3]), endMin: parseMin(m[4], m[5], m[6]),
      });
    });
  }
  return events;
}

// ─── Print helper ─────────────────────────────────────────────────────────────

function printSchedule(teachers: Teacher[]) {
  const events = buildCalEvents(teachers);
  if (events.length === 0) { alert("No scheduled assignments to print."); return; }

  const fmt12 = (min: number) => {
    const h = Math.floor(min / 60), m = min % 60;
    const p = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${p}`;
  };

  // Print palette — same order as COURSE_PALETTE
  const PRINT_COLORS = [
    { bg:"#eff6ff", border:"#60a5fa", text:"#1e40af", dot:"#3b82f6" },
    { bg:"#fffbeb", border:"#fbbf24", text:"#92400e", dot:"#f59e0b" },
    { bg:"#ecfdf5", border:"#34d399", text:"#065f46", dot:"#10b981" },
    { bg:"#f5f3ff", border:"#a78bfa", text:"#4c1d95", dot:"#8b5cf6" },
    { bg:"#fff1f2", border:"#fb7185", text:"#881337", dot:"#f43f5e" },
    { bg:"#ecfeff", border:"#22d3ee", text:"#164e63", dot:"#06b6d4" },
  ];

  // Build hierarchy: course → level → section → [events]
  const courseMap = new Map<string, Map<string, Map<string, CalEvent[]>>>();
  const courseOrder: string[] = [];
  for (const e of events) {
    if (!courseMap.has(e.courseName)) { courseMap.set(e.courseName, new Map()); courseOrder.push(e.courseName); }
    const lvlMap = courseMap.get(e.courseName)!;
    const lvlKey = e.levelName || "—";
    if (!lvlMap.has(lvlKey)) lvlMap.set(lvlKey, new Map());
    const secMap = lvlMap.get(lvlKey)!;
    const secKey = e.sectionName || "—";
    if (!secMap.has(secKey)) secMap.set(secKey, []);
    secMap.get(secKey)!.push(e);
  }

  // Flatten to rows with rowspan counts
  type PRow = { courseSpan?: number; courseName?: string; ci: number;
                levelSpan?: number; levelName?: string;
                section: string; time: string; teacher: string; };
  const prows: PRow[] = [];
  courseOrder.forEach((courseName, ci) => {
    const lvlMap = courseMap.get(courseName)!;
    const minForLvl = (lvl: string) =>
      Math.min(...[...lvlMap.get(lvl)!.values()].flatMap(evts => evts.map(e => e.startMin)));
    const levels = [...lvlMap.keys()].sort((a, b) => minForLvl(a) - minForLvl(b));
    let courseSpan = 0;
    const cStart = prows.length;
    levels.forEach(lvlKey => {
      const secMap   = lvlMap.get(lvlKey)!;
      const minForSec = (s: string) => Math.min(...secMap.get(s)!.map(e => e.startMin));
      const sections = [...secMap.keys()].sort((a, b) => minForSec(a) - minForSec(b));
      let levelSpan  = 0;
      const lStart   = prows.length;
      sections.forEach(secKey => {
        const seEvts = [...secMap.get(secKey)!].sort((a, b) => a.startMin - b.startMin);
        seEvts.forEach((e, ei) => {
          prows.push({ section: ei === 0 ? secKey : "", time: `${fmt12(e.startMin)} – ${fmt12(e.endMin)}`, teacher: e.teacherName, ci });
          levelSpan++; courseSpan++;
        });
      });
      const flr = prows[lStart]; if (flr) { flr.levelSpan = levelSpan; flr.levelName = lvlKey; }
    });
    const fcr = prows[cStart]; if (fcr) { fcr.courseSpan = courseSpan; fcr.courseName = courseName; }
  });

  const tableRows = prows.map(row => {
    const p = PRINT_COLORS[row.ci % PRINT_COLORS.length];
    const courseCell = row.courseSpan !== undefined
      ? `<td rowspan="${row.courseSpan}" style="padding:8px 10px;border:1px solid #e5e7eb;background:${p.bg};border-left:4px solid ${p.border};font-weight:700;font-size:13px;color:${p.text};vertical-align:top;white-space:nowrap;">
           <span style="display:inline-flex;align-items:center;gap:6px;">
             <span style="width:10px;height:10px;border-radius:2px;background:${p.dot};flex-shrink:0;display:inline-block;"></span>
             ${row.courseName}
           </span>
         </td>` : "";
    const levelCell = row.levelSpan !== undefined
      ? `<td rowspan="${row.levelSpan}" style="padding:8px 10px;border:1px solid #e5e7eb;background:${p.bg};font-size:11px;font-weight:700;color:${p.text};vertical-align:top;white-space:nowrap;text-transform:uppercase;letter-spacing:0.05em;">
           ${row.levelName !== "—" ? row.levelName : ""}
         </td>` : "";
    return `<tr>
      ${courseCell}
      ${levelCell}
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#111827;font-weight:500;">${row.section !== "—" ? row.section : ""}</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#374151;white-space:nowrap;">${row.time}</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:13px;color:#374151;">${row.teacher}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<title>Staff Schedule — Bhartiya Hindu Temple Gurukul</title>
<style>
  @page { size: letter portrait; margin: 18mm 15mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; color: #111827; }
  @media print { button { display: none !important; } }
</style>
</head><body>
<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;padding-bottom:16px;border-bottom:3px solid #7c3aed;">
  <div>
    <div style="font-size:11px;color:#7c3aed;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">Bhartiya Hindu Temple · Powell, OH</div>
    <h1 style="font-size:22px;font-weight:800;color:#1e1b4b;margin:0 0 4px;">Staff Schedule</h1>
    <div style="font-size:12px;color:#6b7280;">Generated ${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
  </div>
  <div style="text-align:right;">
    <div style="font-size:11px;color:#6b7280;">Active staff: ${teachers.filter(t=>t.status==="Active").length}</div>
    <div style="font-size:11px;color:#6b7280;">Total sections: ${events.length}</div>
  </div>
</div>
<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;">
  <thead>
    <tr style="background:#f9fafb;">
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;border:1px solid #e5e7eb;">Course</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;border:1px solid #e5e7eb;">Level</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;border:1px solid #e5e7eb;">Section</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;border:1px solid #e5e7eb;white-space:nowrap;">Time (EST)</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;border:1px solid #e5e7eb;">Teacher</th>
    </tr>
  </thead>
  <tbody>${tableRows}</tbody>
</table>
<div style="margin-top:32px;text-align:center;font-size:10px;color:#9ca3af;">Bhartiya Hindu Temple Gurukul &middot; 3671 Hyatts Rd, Powell, OH 43065 &middot; Confidential — Staff Use Only</div>
<div style="margin-top:16px;text-align:center;">
  <button onclick="window.print()" style="background:#7c3aed;color:white;border:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">🖨 Print / Save as PDF</button>
</div>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { alert("Please allow popups to use the print view."); return; }
  w.document.write(html);
  w.document.close();
}

function fmtMin(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  const p = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${p}`;
}

// Fixed palette — cycles through courses in encounter order
const COURSE_PALETTE = [
  { bg: "bg-blue-50",    border: "border-blue-400",    text: "text-blue-800",    dot: "bg-blue-400",    header: "bg-blue-100"    },
  { bg: "bg-amber-50",   border: "border-amber-400",   text: "text-amber-800",   dot: "bg-amber-400",   header: "bg-amber-100"   },
  { bg: "bg-emerald-50", border: "border-emerald-400", text: "text-emerald-800", dot: "bg-emerald-400", header: "bg-emerald-100" },
  { bg: "bg-purple-50",  border: "border-purple-400",  text: "text-purple-800",  dot: "bg-purple-400",  header: "bg-purple-100"  },
  { bg: "bg-rose-50",    border: "border-rose-400",    text: "text-rose-800",    dot: "bg-rose-400",    header: "bg-rose-100"    },
  { bg: "bg-cyan-50",    border: "border-cyan-400",    text: "text-cyan-800",    dot: "bg-cyan-400",    header: "bg-cyan-100"    },
];

function StaffScheduleList({ teachers }: { teachers: Teacher[] }) {
  const events = buildCalEvents(teachers);
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No scheduled sections for the selected curriculum year.</p>;
  }

  // Build hierarchy: course → level → section → [events sorted by time]
  const courseMap = new Map<string, Map<string, Map<string, CalEvent[]>>>();
  const courseOrder: string[] = [];

  for (const e of events) {
    if (!courseMap.has(e.courseName)) { courseMap.set(e.courseName, new Map()); courseOrder.push(e.courseName); }
    const lvlMap = courseMap.get(e.courseName)!;
    const lvlKey = e.levelName || "—";
    if (!lvlMap.has(lvlKey)) lvlMap.set(lvlKey, new Map());
    const secMap = lvlMap.get(lvlKey)!;
    const secKey = e.sectionName || "—";
    if (!secMap.has(secKey)) secMap.set(secKey, []);
    secMap.get(secKey)!.push(e);
  }

  // Flatten into table rows with rowSpan metadata
  type Row = {
    courseSpan?: number; courseName?: string; paletteIdx: number;
    levelSpan?:  number; levelName?: string;
    section: string;
    time: string;
    teacher: string;
  };

  const rows: Row[] = [];
  courseOrder.forEach((courseName, ci) => {
    const lvlMap   = courseMap.get(courseName)!;
    const minForLevel = (lvl: string) =>
      Math.min(...[...lvlMap.get(lvl)!.values()].flatMap(evts => evts.map(e => e.startMin)));
    const levels = [...lvlMap.keys()].sort((a, b) => minForLevel(a) - minForLevel(b));
    let courseSpan = 0;
    const courseStart = rows.length;

    levels.forEach(lvlKey => {
      const secMap  = lvlMap.get(lvlKey)!;
      const minForSec = (s: string) => Math.min(...secMap.get(s)!.map(e => e.startMin));
      const sections = [...secMap.keys()].sort((a, b) => minForSec(a) - minForSec(b));
      let levelSpan  = 0;
      const levelStart = rows.length;

      sections.forEach(secKey => {
        const secEvents = [...secMap.get(secKey)!].sort((a, b) => a.startMin - b.startMin);
        secEvents.forEach((e, ei) => {
          rows.push({
            ...(ei === 0 && levelStart === rows.length ? { levelSpan: 0, levelName: lvlKey } : {}),
            section: ei === 0 ? secKey : "",
            time:    `${fmtMin(e.startMin)} – ${fmtMin(e.endMin)}`,
            teacher: e.teacherName,
            paletteIdx: ci,
          });
          levelSpan++;
          courseSpan++;
        });
      });
      // patch levelSpan onto first row of this level
      const firstLevelRow = rows[levelStart];
      if (firstLevelRow) { firstLevelRow.levelSpan = levelSpan; firstLevelRow.levelName = lvlKey; }
    });
    // patch courseSpan onto first row of this course
    const firstCourseRow = rows[courseStart];
    if (firstCourseRow) { firstCourseRow.courseSpan = courseSpan; firstCourseRow.courseName = courseName; }
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            {["Course","Level","Section","Time","Teacher"].map(h => (
              <th key={h} className="text-left px-3 py-2.5 font-semibold text-muted-foreground border border-border/60 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const p = COURSE_PALETTE[row.paletteIdx % COURSE_PALETTE.length];
            return (
              <tr key={ri} className="border-b border-border/40 hover:bg-gray-50/40 transition-colors">
                {/* Course cell — only rendered on first row of each course */}
                {row.courseSpan !== undefined && (
                  <td rowSpan={row.courseSpan}
                    className={`px-3 py-2.5 border border-border/60 font-bold align-top whitespace-nowrap ${p.bg}`}
                    style={{ borderLeft: `4px solid` }}
                  >
                    <span className={`inline-flex items-center gap-1.5 ${p.text}`}>
                      <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${p.dot}`} />
                      {row.courseName}
                    </span>
                  </td>
                )}

                {/* Level cell */}
                {row.levelSpan !== undefined && (
                  <td rowSpan={row.levelSpan}
                    className={`px-3 py-2.5 border border-border/60 text-[11px] font-semibold align-top whitespace-nowrap ${p.bg} ${p.text} opacity-90`}
                  >
                    {row.levelName !== "—" ? row.levelName : ""}
                  </td>
                )}

                {/* Section */}
                <td className="px-3 py-2.5 border border-border/40 font-medium text-secondary">
                  {row.section !== "—" ? row.section : ""}
                </td>

                {/* Time */}
                <td className="px-3 py-2.5 border border-border/40 text-muted-foreground whitespace-nowrap tabular-nums">
                  {row.time}
                </td>

                {/* Teacher */}
                <td className="px-3 py-2.5 border border-border/40 text-secondary">
                  {row.teacher}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Teacher = {
  id:                  number;
  name:                string;
  email:               string;
  phone:               string;
  category:            string;
  status:              "Active" | "Inactive";
  assistantId:         number | null;
  assistantName:       string | null;
  linkedTeacherId:     number | null;
  linkedTeacherName:   string | null;
  isCoordinatorLinked: boolean;
  courseNames:         string[];
  assignments:         Assignment[];
  curriculumYear:      string | null;
  lastLoginAt:         string | null;
};

const CATEGORIES = ["Teacher", "Assistant"];

const PAGE_SIZE = 25;
type SortKey = "name" | "category" | "curriculumYear" | "lastLoginAt";

type FormState = {
  name:            string;
  email:           string;
  phone:           string;
  category:        string;
  curriculumYear:  string;
  // For Teachers: the assistant they are paired with
  assistantId:     number | null;
  // For Assistants: the teacher they are paired with
  linkedTeacherId: number | null;
};

const emptyForm: FormState = {
  name: "", email: "", phone: "",
  category: "Teacher",
  curriculumYear:  "",
  assistantId:     null,
  linkedTeacherId: null,
};

export default function Teachers() {
  const { activeYearsListLong, activeCurriculumYearLong } = usePortalSettings();
  const [teachers,        setTeachers]        = useState<Teacher[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState(false);
  const [search,          setSearch]          = useState("");
  const [filterCat,       setFilterCat]       = useState("All");
  const [filterYear,      setFilterYear]      = useState("All");
  const [activeTab,       setActiveTab]       = useState<"staff-list" | "staff-schedule">("staff-list");
  const [showModal,       setShowModal]       = useState(false);
  const [editing,         setEditing]         = useState<Teacher | null>(null);
  const [form,            setForm]            = useState<FormState>(emptyForm);
  const [deleteConfirm,   setDeleteConfirm]   = useState<number | null>(null);
  const [error,           setError]           = useState("");
  // PIN banner state — shown after create or reset
  const [pinBanner,       setPinBanner]       = useState<{ name: string; pin: string } | null>(null);
  const [showPin,         setShowPin]         = useState(false);
  const [resettingPin,    setResettingPin]    = useState<number | null>(null);
  const [showFilters,     setShowFilters]     = useState(false);
  const [sortKey,         setSortKey]         = useState<SortKey>("name");
  const [sortAsc,         setSortAsc]         = useState(true);
  const [page,            setPage]            = useState(1);
  const [pageInput,       setPageInput]       = useState("1");
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    adminApi.teachers.list().then((data) => {
      setTeachers(data as Teacher[]);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeCurriculumYearLong) setFilterYear(activeCurriculumYearLong);
  }, [activeCurriculumYearLong]);

  useEffect(() => { setPage(1); setPageInput("1"); }, [search, filterCat, filterYear, sortKey, sortAsc]);

  // Derive lists for dropdowns from loaded teachers
  const assistantOptions = teachers.filter((t) => t.category === "Assistant");
  const teacherOptions   = teachers.filter((t) => t.category !== "Assistant");

  const filtered = useMemo(() => {
    const base = teachers.filter((t) => {
      const matchesCat    = filterCat === "All" || t.category === filterCat;
      const matchesYear   = filterYear === "All" || t.curriculumYear === filterYear;
      const matchesSearch =
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.email.toLowerCase().includes(search.toLowerCase());
      return matchesCat && matchesYear && matchesSearch;
    });
    return [...base].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortKey === "name")           { av = a.name;                                          bv = b.name; }
      else if (sortKey === "category")  { av = a.category ?? "";                                bv = b.category ?? ""; }
      else if (sortKey === "curriculumYear") { av = a.curriculumYear ?? "";                     bv = b.curriculumYear ?? ""; }
      else if (sortKey === "lastLoginAt")    { av = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
                                              bv = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0; }
      if (av === bv) return 0;
      if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [teachers, search, filterCat, filterYear, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function goToPage(n: number) {
    const clamped = Math.max(1, Math.min(n, totalPages));
    setPage(clamped);
    setPageInput(String(clamped));
    tableRef.current?.scrollTo({ top: 0 });
  }

  const activeFilterCount = (filterCat !== "All" ? 1 : 0) + (filterYear !== "All" ? 1 : 0);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronUp className="w-3 h-3 opacity-20 inline ml-1" />;
    return sortAsc
      ? <ChevronUp className="w-3 h-3 inline ml-1 text-primary" />
      : <ChevronDown className="w-3 h-3 inline ml-1 text-primary" />;
  }

  function openAdd() {
    setEditing(null);
    setForm({ ...emptyForm, curriculumYear: filterYear === "All" ? (activeCurriculumYearLong || "") : filterYear });
    setError("");
    setShowModal(true);
  }

  function openEdit(t: Teacher) {
    setEditing(t);
    setForm({
      name:            t.name,
      email:           t.email,
      phone:           formatUSPhone(t.phone),
      category:        t.category || "Teacher",
      curriculumYear:  t.curriculumYear || (activeCurriculumYearLong || ""),
      assistantId:     t.assistantId,
      linkedTeacherId: t.linkedTeacherId,
    });
    setError("");
    setShowModal(true);
  }

  // When category changes, clear the pairing fields
  function handleCategoryChange(cat: string) {
    setForm((f) => ({ ...f, category: cat, assistantId: null, linkedTeacherId: null }));
  }

  async function handleSave() {
    const nameErr  = validatePersonName(form.name, "Full name");
    if (nameErr)  { setError(nameErr); return; }
    const emailErr = validateEmail(form.email);
    if (emailErr) { setError(emailErr); return; }
    const phoneErr = validateUSPhone(form.phone);
    if (phoneErr) { setError(`Phone: ${phoneErr} — This is used as the staff member's login identifier.`); return; }
    if (!form.category)     { setError("Category is required."); return; }

    setSaving(true);
    try {
      const payload = { ...form, phone: form.phone.replace(/\D/g, "") };

      if (editing) {
        await adminApi.teachers.update(editing.id, payload);
        const fresh = await adminApi.teachers.list();
        setTeachers(fresh as Teacher[]);
      } else {
        const result = await adminApi.teachers.create(payload) as { id?: number; generatedPin?: string; name?: string };
        const fresh = await adminApi.teachers.list();
        setTeachers(fresh as Teacher[]);
        // Show the generated PIN banner
        if (result?.generatedPin) {
          setPinBanner({ name: form.name.trim(), pin: result.generatedPin });
          setShowPin(false);
        }
      }

      setShowModal(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPin(teacher: Teacher) {
    setResettingPin(teacher.id);
    try {
      const result = await adminApi.teachers.resetPin(teacher.id);
      setPinBanner({ name: teacher.name, pin: result.pin });
      setShowPin(false);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to reset PIN");
    } finally {
      setResettingPin(null);
    }
  }

  async function handleDelete(id: number) {
    try {
      await adminApi.teachers.remove(id);
      setTeachers((prev) => prev.filter((t) => t.id !== id));
      setDeleteConfirm(null);
    } catch (e: unknown) {
      setDeleteConfirm(null);
      const msg = e instanceof Error ? e.message : "Failed to delete staff member.";
      toast.error(msg);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const selectCls = "w-full border border-input rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ring";

  const isAssistantForm = form.category === "Assistant";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-secondary">Staff Management</h2>
          <p className="text-sm text-muted-foreground">
            {teachers.filter((t) => t.status === "Active").length} active staff ·{" "}
            <span className="text-orange-500 font-medium">Course assignments can be done in the course management section</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={openAdd} className="gap-2 rounded-xl">
            <Plus className="w-4 h-4" /> Add Staff
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: "staff-list",     label: "Staff List",     Icon: Users },
          { key: "staff-schedule", label: "Staff Schedule", Icon: ScheduleIcon },
        ] as { key: "staff-list" | "staff-schedule"; label: string; Icon: React.ElementType }[]).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === key
                ? "bg-white text-secondary shadow-sm"
                : "text-muted-foreground hover:text-secondary"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* PIN Banner — shown after create or reset */}
      {pinBanner && (
        <div className="bg-green-50 border border-green-300 rounded-2xl p-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-green-800 mb-1">
              🔑 Login credentials for <span className="font-black">{pinBanner.name}</span>
            </p>
            <p className="text-xs text-green-700 mb-2">
              Share these with the staff member. The PIN is shown <strong>once only</strong> and cannot be retrieved later.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="bg-white border border-green-300 rounded-xl px-4 py-2 flex items-center gap-3 shadow-sm">
                <span className="text-xs text-green-600 font-semibold">PIN:</span>
                <span className="font-black text-xl tracking-widest text-green-900 font-mono">
                  {showPin ? pinBanner.pin : "••••"}
                </span>
                <button
                  onClick={() => setShowPin((v) => !v)}
                  className="text-green-600 hover:text-green-800 transition-colors"
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-green-600">
                Login: phone number as username · {pinBanner.pin.length}-digit PIN as password
              </p>
            </div>
          </div>
          <button
            onClick={() => setPinBanner(null)}
            className="text-green-600 hover:text-green-800 shrink-0 mt-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search bar + filter toggle */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            className="pl-9 rounded-xl"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors shrink-0 ${
            showFilters || activeFilterCount > 0
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-white border-border text-muted-foreground hover:border-primary"
          }`}
        >
          <Filter className="w-4 h-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="bg-primary text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">{activeFilterCount}</span>
          )}
        </button>
      </div>

      {/* Collapsible filter panel */}
      {showFilters && (
        <div className="bg-gray-50 border border-border rounded-2xl p-4 flex flex-wrap gap-4">
          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</span>
            <div className="flex flex-wrap gap-1.5">
              {["All", ...CATEGORIES].map((c) => (
                <button
                  key={c}
                  onClick={() => setFilterCat(c)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    filterCat === c
                      ? "bg-primary text-white"
                      : "bg-white border border-border text-muted-foreground hover:border-primary"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          {/* Year */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Curriculum Year</span>
            <div className="flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                className="text-sm border border-border rounded-lg px-3 py-1.5 bg-white text-secondary focus:outline-none focus:border-primary"
              >
                <option value="All">All Years</option>
                {activeYearsListLong.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="flex items-end">
              <button
                onClick={() => { setFilterCat("All"); setFilterYear(activeCurriculumYearLong || "All"); }}
                className="text-xs text-primary hover:underline font-medium"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Staff List Tab ─────────────────────────────────────────── */}
      {activeTab === "staff-list" && (
      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div ref={tableRef} className="overflow-auto max-h-[560px]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-border sticky top-0 z-10">
              <tr>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("name")}>
                  Staff Member<SortIcon col="name" />
                </th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("category")}>
                  Category / Paired<SortIcon col="category" />
                </th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Courses</th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("lastLoginAt")}>
                  Last Login<SortIcon col="lastLoginAt" />
                </th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No staff found.</td></tr>
              )}
              {paginated.map((t) => {
                const pairedName = t.category !== "Assistant" ? t.assistantName : t.linkedTeacherName;
                return (
                <tr key={t.id} className="border-b border-border/50 hover:bg-gray-50 transition-colors align-top">
                  {/* Name + Contact */}
                  <td className="px-4 py-3 min-w-[200px]">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center font-bold text-sm shrink-0">
                        {t.name.split(" ").pop()?.charAt(0) ?? "T"}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-secondary truncate">{t.name}</div>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Mail className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{t.email}</span>
                        </div>
                        {t.phone && (
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Phone className="w-2.5 h-2.5 shrink-0" />
                            <span>{t.phone}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Category + Paired */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      <span className={`self-start text-xs px-2 py-0.5 rounded-full font-medium ${
                        t.category === "Assistant" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                      }`}>
                        {t.category || "Teacher"}
                      </span>
                      {t.isCoordinatorLinked && (
                        <span className="self-start text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-purple-100 text-purple-700 border border-purple-200">
                          Coordinator
                        </span>
                      )}
                      {pairedName && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <UserCheck className="w-3 h-3 shrink-0" />
                          <span className="truncate max-w-[120px]">{pairedName}</span>
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Assigned sections — course · level · section per line */}
                  <td className="px-4 py-3">
                    {t.assignments.length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">None assigned</span>
                    ) : (
                      <div className="space-y-1">
                        {t.assignments.map((a, i) => (
                          <div key={i} className="flex items-center gap-1 text-[11px] whitespace-nowrap">
                            <BookOpen className="w-2.5 h-2.5 text-primary shrink-0" />
                            <span className="font-medium text-secondary">{a.courseName}</span>
                            {a.levelName  && <><span className="text-muted-foreground/50">·</span><span className="text-muted-foreground">{a.levelName}</span></>}
                            {a.sectionName && <><span className="text-muted-foreground/50">·</span><span className="text-muted-foreground">{a.sectionName}</span></>}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>

                  {/* Last Login */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {t.lastLoginAt ? (
                      <>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3 shrink-0 text-green-600" />
                          <span className="font-medium text-green-700">
                            {(() => {
                              const diff = Date.now() - new Date(t.lastLoginAt).getTime();
                              const mins = Math.floor(diff / 60000);
                              if (mins < 1)  return "Just now";
                              if (mins < 60) return `${mins}m ago`;
                              const hrs = Math.floor(mins / 60);
                              if (hrs < 24)  return `${hrs}h ago`;
                              const days = Math.floor(hrs / 24);
                              if (days < 7)  return `${days}d ago`;
                              return new Date(t.lastLoginAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                            })()}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground/60 mt-0.5 pl-4.5">
                          {new Date(t.lastLoginAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </div>
                      </>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground/60">
                        <Clock className="w-3 h-3 shrink-0" />
                        Never
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => openEdit(t)}
                        title="Edit profile"
                        className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleResetPin(t)}
                        title="Reset login PIN"
                        disabled={resettingPin === t.id}
                        className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 flex items-center justify-center transition-colors disabled:opacity-50"
                      >
                        {resettingPin === t.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <KeyRound className="w-3.5 h-3.5" />
                        }
                      </button>
                      {deleteConfirm === t.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => handleDelete(t.id)} className="w-7 h-7 rounded-lg bg-red-500 text-white hover:bg-red-600 flex items-center justify-center">
                            <Check className="w-3 h-3" />
                          </button>
                          <button onClick={() => setDeleteConfirm(null)} className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(t.id)}
                          title="Delete staff member"
                          className="w-7 h-7 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Pagination footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-gray-50/50">
            <span className="text-xs text-muted-foreground">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(page - 1)} disabled={page === 1} className="w-7 h-7 rounded-lg flex items-center justify-center border border-border bg-white disabled:opacity-40 hover:bg-gray-100 transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1.5 px-1">
                <span className="text-xs text-muted-foreground">Page</span>
                <input
                  type="number" min={1} max={totalPages}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && goToPage(parseInt(pageInput))}
                  onBlur={() => goToPage(parseInt(pageInput))}
                  className="w-12 text-center text-xs border border-border rounded-lg px-1 py-1 focus:outline-none focus:border-primary"
                />
                <span className="text-xs text-muted-foreground">of {totalPages}</span>
              </div>
              <button onClick={() => goToPage(page + 1)} disabled={page === totalPages} className="w-7 h-7 rounded-lg flex items-center justify-center border border-border bg-white disabled:opacity-40 hover:bg-gray-100 transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── Staff Schedule Tab ──────────────────────────────────────── */}
      {activeTab === "staff-schedule" && (
        <div className="bg-white rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-5 gap-2">
            <div>
              <h3 className="font-bold text-secondary">Staff Schedule</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Weekly section assignments by time · filtered by curriculum year</p>
            </div>
            <button
              onClick={() => printSchedule(filtered)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-white text-muted-foreground hover:bg-gray-50 hover:text-secondary transition-colors shrink-0"
              title="Open printable schedule"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
          <StaffScheduleList teachers={filtered} />
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-border shrink-0">
              <h3 className="text-lg font-bold text-secondary">{editing ? "Edit Staff Profile" : "Add Staff Member"}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {editing
                  ? "Update profile details. To change login PIN, use the 🔑 button on the table row."
                  : "A 4-digit login PIN will be auto-generated and displayed once after saving."}
              </p>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>
              )}

              <div className="space-y-1.5">
                <Label>Full Name <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="Full name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Email <span className="text-red-500">*</span></Label>
                <Input
                  type="email"
                  placeholder="Email address"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Phone <span className="text-red-500">*</span></Label>
                <Input
                  type="tel"
                  placeholder="(614) 555-0101"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: formatUSPhone(e.target.value) }))}
                  maxLength={14}
                  className="rounded-xl"
                />
                <p className="text-xs text-muted-foreground">US 10-digit number — used as the login identifier for portal access.</p>
              </div>

              <div className="space-y-1.5">
                <Label>Curriculum Year <span className="text-red-500">*</span></Label>
                <select
                  value={form.curriculumYear}
                  onChange={(e) => setForm((f) => ({ ...f, curriculumYear: e.target.value }))}
                  className={selectCls}
                >
                  {activeYearsListLong.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Category <span className="text-red-500">*</span></Label>
                <select
                  value={form.category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className={selectCls}
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Pairing field — context-sensitive */}
              {!isAssistantForm && (
                <div className="space-y-1.5">
                  <Label>Teaching Assistant <span className="text-xs text-muted-foreground ml-1">(optional)</span></Label>
                  <select
                    value={form.assistantId ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, assistantId: e.target.value ? parseInt(e.target.value) : null }))}
                    className={selectCls}
                  >
                    <option value="">— None —</option>
                    {assistantOptions
                      .filter((a) => !editing || a.id !== editing.id)
                      .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)
                    }
                  </select>
                  {assistantOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">No assistants found. Add a staff member with the "Assistant" category first.</p>
                  )}
                </div>
              )}

              {isAssistantForm && (
                <div className="space-y-1.5">
                  <Label>Assigned to Teacher <span className="text-xs text-muted-foreground ml-1">(optional)</span></Label>
                  <select
                    value={form.linkedTeacherId ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, linkedTeacherId: e.target.value ? parseInt(e.target.value) : null }))}
                    className={selectCls}
                  >
                    <option value="">— None —</option>
                    {teacherOptions
                      .filter((t) => !editing || t.id !== editing.id)
                      .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)
                    }
                  </select>
                  {teacherOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">No teachers found. Add a teacher first.</p>
                  )}
                </div>
              )}

            </div>

            <div className="p-6 border-t border-border flex justify-end gap-3 shrink-0">
              <Button variant="outline" onClick={() => setShowModal(false)} className="rounded-xl" disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} className="rounded-xl gap-2" disabled={saving}>
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {editing ? "Save Changes" : "Add Staff"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
