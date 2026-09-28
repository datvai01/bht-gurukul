import { useState, useEffect, useMemo, useRef } from "react";
import { adminApi } from "@/lib/adminApi";
import { Plus, Edit2, Trash2, Check, X, Search, AlertTriangle, RefreshCw, Loader2, CalendarDays, BookOpen, Filter, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortalSettings } from "@/admin/contexts/PortalSettingsContext";

type InventoryItem = {
  id: number; name: string; category: string; dateProcured: string;
  quantityProcured: number; currentStock: number; reorderLevel: number;
  lastReplenishment: string; vendor: string; remarks: string;
  curriculumYear: string | null;
  courseId: number | null; courseName: string | null;
  levelId:  number | null; levelName:  string | null;
};

type CourseOption = {
  id: number;
  name: string;
  levels: { id: number; levelNumber: number; className: string }[];
};

const categories = ["All", "Books", "Bags", "Papers", "Supplies"];

const PAGE_SIZE = 50;
type SortKey = "name" | "category" | "currentStock" | "dateProcured" | "vendor";

const emptyForm: Omit<InventoryItem, "id"> = {
  name: "", category: "Books", dateProcured: "",
  quantityProcured: 0, currentStock: 0, reorderLevel: 5,
  lastReplenishment: "", vendor: "", remarks: "",
  curriculumYear: null,
  courseId: null, courseName: null,
  levelId:  null, levelName:  null,
};

const selectCls = "w-full border border-input rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ring";

export default function Inventory() {
  const { activeYearsListLong, activeCurriculumYearLong } = usePortalSettings();
  const [items,         setItems]         = useState<InventoryItem[]>([]);
  const [courses,       setCourses]       = useState<CourseOption[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [search,        setSearch]        = useState("");
  const [filterCat,     setFilterCat]     = useState("All");
  const [filterYear,    setFilterYear]    = useState("All");
  const [filterCourse,  setFilterCourse]  = useState<number | "All">("All");
  const [filterLevel,   setFilterLevel]   = useState<number | "All">("All");
  const [showLowOnly,   setShowLowOnly]   = useState(false);
  const [showModal,     setShowModal]     = useState(false);
  const [editing,       setEditing]       = useState<InventoryItem | null>(null);
  const [form,          setForm]          = useState<Omit<InventoryItem, "id">>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [replenishItem, setReplenishItem] = useState<InventoryItem | null>(null);
  const [replenishQty,  setReplenishQty]  = useState(10);
  const [showFilters,   setShowFilters]   = useState(false);
  const [sortKey,       setSortKey]       = useState<SortKey>("name");
  const [sortAsc,       setSortAsc]       = useState(true);
  const [page,          setPage]          = useState(1);
  const [pageInput,     setPageInput]     = useState("1");
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    adminApi.inventory.list().then((d) => setItems(d as InventoryItem[])).finally(() => setLoading(false));
    adminApi.courses.list().then((d) => {
      const raw = d as { id: number; name: string; levels: { id: number; levelNumber: number; className: string }[] }[];
      setCourses(raw.map(c => ({ id: c.id, name: c.name, levels: c.levels ?? [] })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeCurriculumYearLong) setFilterYear(activeCurriculumYearLong);
  }, [activeCurriculumYearLong]);

  useEffect(() => { setPage(1); setPageInput("1"); }, [search, filterCat, filterYear, filterCourse, filterLevel, showLowOnly, sortKey, sortAsc]);

  // When course filter changes, reset level filter
  function handleFilterCourse(val: number | "All") {
    setFilterCourse(val);
    setFilterLevel("All");
  }

  // Levels available for the selected filter course
  const filterCourseLevels =
    filterCourse === "All" ? [] : (courses.find(c => c.id === filterCourse)?.levels ?? []);

  // Levels available for the form's selected course
  const formCourseLevels =
    form.courseId ? (courses.find(c => c.id === form.courseId)?.levels ?? []) : [];

  const filtered = useMemo(() => {
    const base = items.filter((i) =>
      (filterCat    === "All" || i.category      === filterCat) &&
      (filterYear   === "All" || i.curriculumYear === filterYear) &&
      (filterCourse === "All" || i.courseId       === filterCourse) &&
      (filterLevel  === "All" || i.levelId        === filterLevel) &&
      (!showLowOnly || i.currentStock <= i.reorderLevel) &&
      i.name.toLowerCase().includes(search.toLowerCase())
    );
    return [...base].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortKey === "name")              { av = a.name;                 bv = b.name; }
      else if (sortKey === "category")     { av = a.category;             bv = b.category; }
      else if (sortKey === "currentStock") { av = a.currentStock;         bv = b.currentStock; }
      else if (sortKey === "dateProcured") { av = a.dateProcured ?? "";   bv = b.dateProcured ?? ""; }
      else if (sortKey === "vendor")       { av = a.vendor ?? "";         bv = b.vendor ?? ""; }
      if (av === bv) return 0;
      if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [items, search, filterCat, filterYear, filterCourse, filterLevel, showLowOnly, sortKey, sortAsc]);

  const lowStockItems = items.filter((i) => i.currentStock <= i.reorderLevel);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function goToPage(n: number) {
    const clamped = Math.max(1, Math.min(n, totalPages));
    setPage(clamped);
    setPageInput(String(clamped));
    tableRef.current?.scrollTo({ top: 0 });
  }

  const activeFilterCount =
    (filterCat    !== "All" ? 1 : 0) +
    (filterYear   !== "All" ? 1 : 0) +
    (filterCourse !== "All" ? 1 : 0) +
    (filterLevel  !== "All" ? 1 : 0) +
    (showLowOnly ? 1 : 0);

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
    setForm({
      ...emptyForm,
      curriculumYear: filterYear   === "All" ? (activeCurriculumYearLong || null) : filterYear,
      courseId:       filterCourse === "All" ? null : filterCourse,
      levelId:        filterLevel  === "All" ? null : filterLevel,
      courseName:     filterCourse === "All" ? null : (courses.find(c => c.id === filterCourse)?.name ?? null),
      levelName:      filterLevel  === "All" ? null : (filterCourseLevels.find(l => l.id === filterLevel)?.className ?? null),
    });
    setShowModal(true);
  }

  function openEdit(item: InventoryItem) {
    setEditing(item);
    setForm({
      name: item.name, category: item.category, dateProcured: item.dateProcured,
      quantityProcured: item.quantityProcured, currentStock: item.currentStock,
      reorderLevel: item.reorderLevel, lastReplenishment: item.lastReplenishment,
      vendor: item.vendor, remarks: item.remarks, curriculumYear: item.curriculumYear,
      courseId: item.courseId, courseName: item.courseName,
      levelId:  item.levelId,  levelName:  item.levelName,
    });
    setShowModal(true);
  }

  function handleFormCourseChange(courseIdStr: string) {
    const courseId = courseIdStr ? parseInt(courseIdStr) : null;
    const course   = courseId ? courses.find(c => c.id === courseId) : null;
    setForm(f => ({ ...f, courseId, courseName: course?.name ?? null, levelId: null, levelName: null }));
  }

  function handleFormLevelChange(levelIdStr: string) {
    const levelId  = levelIdStr ? parseInt(levelIdStr) : null;
    const level    = levelId ? formCourseLevels.find(l => l.id === levelId) : null;
    setForm(f => ({ ...f, levelId, levelName: level?.className ?? null }));
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        const updated = await adminApi.inventory.update(editing.id, form);
        setItems((prev) => prev.map((i) => i.id === editing.id ? updated as InventoryItem : i));
      } else {
        const created = await adminApi.inventory.create(form);
        setItems((prev) => [...prev, created as InventoryItem]);
      }
      setShowModal(false);
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    try {
      await adminApi.inventory.remove(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      setDeleteConfirm(null);
    } catch { /* silent */ }
  }

  async function handleReplenish() {
    if (!replenishItem || replenishQty <= 0) return;
    setSaving(true);
    try {
      const updated = await adminApi.inventory.replenish(replenishItem.id, replenishQty);
      setItems((prev) => prev.map((i) => i.id === replenishItem.id ? updated as InventoryItem : i));
      setReplenishItem(null); setReplenishQty(10);
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  function stockLevel(item: InventoryItem) {
    if (item.currentStock === 0) return { label: "Out of Stock", cls: "bg-red-100 text-red-700" };
    if (item.currentStock <= item.reorderLevel) return { label: "Low Stock", cls: "bg-orange-100 text-orange-700" };
    return { label: "In Stock", cls: "bg-green-100 text-green-700" };
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-secondary">Inventory</h2>
          <p className="text-sm text-muted-foreground">{items.length} items • {lowStockItems.length} low stock alerts</p>
        </div>
        <Button onClick={openAdd} className="gap-2 rounded-xl shrink-0">
          <Plus className="w-4 h-4" /> Add Item
        </Button>
      </div>

      {/* Low Stock Banner */}
      {lowStockItems.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            <span className="font-semibold text-orange-800 text-sm">Low Stock Alerts ({lowStockItems.length} items)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {lowStockItems.map((i) => (
              <div key={i.id} className="bg-white border border-orange-200 rounded-xl px-3 py-1.5 text-xs flex items-center gap-2">
                <span className="font-medium text-orange-800">{i.name}</span>
                <span className="text-orange-600">{i.currentStock} left</span>
                <button onClick={() => { setReplenishItem(i); setReplenishQty(10); }} className="text-primary hover:underline font-medium">Replenish</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search bar + filter toggle */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search items..." className="pl-9 rounded-xl" value={search} onChange={(e) => setSearch(e.target.value)} />
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
          {/* Category chips */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</span>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <button key={c} onClick={() => setFilterCat(c)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${filterCat === c ? "bg-primary text-white" : "bg-white border border-border text-muted-foreground hover:border-primary"}`}>{c}</button>
              ))}
            </div>
          </div>
          {/* Low stock toggle */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stock Alert</span>
            <button onClick={() => setShowLowOnly(!showLowOnly)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${showLowOnly ? "bg-orange-500 text-white" : "bg-white border border-border text-muted-foreground hover:border-orange-400"}`}>
              <AlertTriangle className="w-3 h-3" /> Low Stock Only
            </button>
          </div>
          {/* Year */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Year</span>
            <div className="flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
              <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-1.5 bg-white text-secondary focus:outline-none focus:border-primary">
                <option value="All">All Years</option>
                {activeYearsListLong.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          {/* Course + Level */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Course / Level</span>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                <select value={filterCourse === "All" ? "" : filterCourse} onChange={(e) => handleFilterCourse(e.target.value ? parseInt(e.target.value) : "All")} className="text-sm border border-border rounded-lg px-3 py-1.5 bg-white text-secondary focus:outline-none focus:border-primary">
                  <option value="">All Courses</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {filterCourse !== "All" && filterCourseLevels.length > 0 && (
                <select value={filterLevel === "All" ? "" : filterLevel} onChange={(e) => setFilterLevel(e.target.value ? parseInt(e.target.value) : "All")} className="text-sm border border-border rounded-lg px-3 py-1.5 bg-white text-secondary focus:outline-none focus:border-primary">
                  <option value="">All Levels</option>
                  {filterCourseLevels.map((l) => <option key={l.id} value={l.id}>{l.className}</option>)}
                </select>
              )}
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="flex items-end">
              <button onClick={() => { setFilterCat("All"); setFilterYear(activeCurriculumYearLong || "All"); setFilterCourse("All"); setFilterLevel("All"); setShowLowOnly(false); }} className="text-xs text-primary hover:underline font-medium">
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div ref={tableRef} className="overflow-auto max-h-[560px]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-border sticky top-0 z-10">
              <tr>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("name")}>
                  Item Name<SortIcon col="name" />
                </th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Course / Level</th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("category")}>
                  Category<SortIcon col="category" />
                </th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("dateProcured")}>
                  Procured<SortIcon col="dateProcured" />
                </th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Qty Procured</th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("currentStock")}>
                  Current Stock<SortIcon col="currentStock" />
                </th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Reorder Level</th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Last Replenished</th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("vendor")}>
                  Vendor<SortIcon col="vendor" />
                </th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Status</th>
                <th className="text-left font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={11} className="text-center py-12 text-muted-foreground">No items found.</td></tr>}
              {paginated.map((item) => {
                const { label, cls } = stockLevel(item);
                return (
                  <tr key={item.id} className={`border-b border-border/50 hover:bg-gray-50 transition-colors ${item.currentStock <= item.reorderLevel ? "bg-orange-50/30" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-secondary">{item.name}</div>
                      {item.remarks && <div className="text-xs text-muted-foreground mt-0.5">{item.remarks}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {item.courseName ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-primary">{item.courseName}</span>
                          {item.levelName && <span className="text-[11px] text-muted-foreground">{item.levelName}</span>}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-md font-medium">{item.category}</span></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{item.dateProcured}</td>
                    <td className="px-4 py-3 text-xs font-medium text-center">{item.quantityProcured}</td>
                    <td className="px-4 py-3"><div className="text-sm font-bold text-secondary text-center">{item.currentStock}</div></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground text-center">{item.reorderLevel}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{item.lastReplenishment}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{item.vendor}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <button onClick={() => { setReplenishItem(item); setReplenishQty(10); }} title="Replenish" className="w-7 h-7 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 flex items-center justify-center transition-colors">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => openEdit(item)} className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-colors">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {deleteConfirm === item.id ? (
                          <div className="flex gap-1">
                            <button onClick={() => handleDelete(item.id)} className="w-7 h-7 rounded-lg bg-red-500 text-white hover:bg-red-600 flex items-center justify-center"><Check className="w-3 h-3" /></button>
                            <button onClick={() => setDeleteConfirm(null)} className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center"><X className="w-3 h-3" /></button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteConfirm(item.id)} className="w-7 h-7 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition-colors">
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

      {/* Replenish Modal */}
      {replenishItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="p-6 border-b border-border">
              <h3 className="text-lg font-bold text-secondary">Record Replenishment</h3>
              <p className="text-sm text-muted-foreground mt-1">{replenishItem.name}</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between text-sm bg-gray-50 rounded-xl p-3">
                <span className="text-muted-foreground">Current Stock</span>
                <span className="font-bold text-secondary">{replenishItem.currentStock}</span>
              </div>
              <div className="space-y-1.5">
                <Label>Quantity to Add</Label>
                <Input type="number" min={1} value={replenishQty} onChange={(e) => setReplenishQty(+e.target.value)} className="rounded-xl" />
              </div>
              <div className="flex justify-between text-sm bg-primary/5 rounded-xl p-3">
                <span className="text-muted-foreground">New Stock After</span>
                <span className="font-bold text-primary">{replenishItem.currentStock + replenishQty}</span>
              </div>
            </div>
            <div className="p-6 border-t border-border flex justify-end gap-3">
              <Button variant="outline" onClick={() => setReplenishItem(null)} className="rounded-xl" disabled={saving}>Cancel</Button>
              <Button onClick={handleReplenish} className="rounded-xl gap-2" disabled={replenishQty <= 0 || saving}>
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Confirm Replenishment
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-border">
              <h3 className="text-lg font-bold text-secondary">{editing ? "Edit Item" : "Add Inventory Item"}</h3>
            </div>
            <div className="p-6 space-y-4">
              {/* Name */}
              <div className="space-y-1.5">
                <Label>Item Name <span className="text-red-500">*</span></Label>
                <Input placeholder="Item name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="rounded-xl" />
              </div>

              {/* Curriculum Year */}
              <div className="space-y-1.5">
                <Label>Curriculum Year <span className="text-red-500">*</span></Label>
                <select value={form.curriculumYear ?? ""} onChange={(e) => setForm((f) => ({ ...f, curriculumYear: e.target.value }))} className={selectCls}>
                  {activeYearsListLong.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              {/* Category + Date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={selectCls}>
                    {categories.filter((c) => c !== "All").map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Date Procured</Label>
                  <Input type="date" value={form.dateProcured} onChange={(e) => setForm((f) => ({ ...f, dateProcured: e.target.value }))} className="rounded-xl" />
                </div>
              </div>

              {/* Course association */}
              <div className="space-y-1.5">
                <Label>Associated Course <span className="text-xs text-muted-foreground ml-1">(optional)</span></Label>
                <select
                  value={form.courseId ?? ""}
                  onChange={(e) => handleFormCourseChange(e.target.value)}
                  className={selectCls}
                >
                  <option value="">— No course —</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Level — shown only when a course is selected and it has levels */}
              {form.courseId !== null && formCourseLevels.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Level <span className="text-xs text-muted-foreground ml-1">(optional)</span></Label>
                  <select
                    value={form.levelId ?? ""}
                    onChange={(e) => handleFormLevelChange(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">— All levels —</option>
                    {formCourseLevels.map((l) => <option key={l.id} value={l.id}>{l.className}</option>)}
                  </select>
                </div>
              )}

              {/* Stock quantities */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5"><Label>Qty Procured</Label><Input type="number" min={0} value={form.quantityProcured} onChange={(e) => setForm((f) => ({ ...f, quantityProcured: +e.target.value }))} className="rounded-xl" /></div>
                <div className="space-y-1.5"><Label>Current Stock</Label><Input type="number" min={0} value={form.currentStock} onChange={(e) => setForm((f) => ({ ...f, currentStock: +e.target.value }))} className="rounded-xl" /></div>
                <div className="space-y-1.5"><Label>Reorder Level</Label><Input type="number" min={0} value={form.reorderLevel} onChange={(e) => setForm((f) => ({ ...f, reorderLevel: +e.target.value }))} className="rounded-xl" /></div>
              </div>

              <div className="space-y-1.5"><Label>Vendor / Source</Label><Input placeholder="Vendor name" value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} className="rounded-xl" /></div>
              <div className="space-y-1.5"><Label>Remarks</Label><Input placeholder="Optional notes" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} className="rounded-xl" /></div>
            </div>
            <div className="p-6 border-t border-border flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowModal(false)} className="rounded-xl" disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} className="rounded-xl gap-2" disabled={!form.name.trim() || saving}>
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {editing ? "Save Changes" : "Add Item"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
