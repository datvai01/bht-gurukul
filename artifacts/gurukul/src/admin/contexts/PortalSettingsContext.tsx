import { createContext, useContext, useEffect, useState, useCallback } from "react";

const START_YEAR = 2024;
const NUM_YEARS  = 50;

export const CURRICULUM_YEARS_SHORT: string[] = Array.from({ length: NUM_YEARS }, (_, i) => {
  const s = START_YEAR + i;
  return `${s}-${String(s + 1).slice(-2)}`;
});

export const CURRICULUM_YEARS_LONG: string[] = Array.from({ length: NUM_YEARS }, (_, i) => {
  const s = START_YEAR + i;
  return `${s}-${s + 1}`;
});

export function shortToLong(short: string): string {
  const [startStr, endSlice] = short.split("-");
  if (!startStr || !endSlice) return short;
  const start = parseInt(startStr, 10);
  const end = endSlice.length === 2
    ? Math.floor(start / 100) * 100 + parseInt(endSlice, 10)
    : parseInt(endSlice, 10);
  return `${start}-${end}`;
}

export function longToShort(long: string): string {
  const [startStr, endStr] = long.split("-");
  if (!startStr || !endStr) return long;
  return `${startStr}-${endStr.slice(-2)}`;
}

const DEFAULT_ACTIVE_YEARS_LONG = ["2026-2027", "2027-2028"];

interface PortalSettingsContextValue {
  activeCurriculumYear:     string;
  activeCurriculumYearLong: string;
  curriculumYears:          string[];
  curriculumYearsLong:      string[];
  /** Years configured as "active" in Settings — the list shown in all management page dropdowns */
  activeYearsListLong:      string[];
  activeYearsListShort:     string[];
  /** Course fee per child in dollars (from admin settings) */
  courseFee:                number;
  /** Annual membership fee in dollars (from admin settings) */
  membershipFee:            number;
  loading:                  boolean;
  setActiveCurriculumYear:  (year: string) => Promise<void>;
  /** Update context state only — does NOT call the API (use adminApi for the actual save) */
  setActiveYearLocally:     (shortYear: string) => void;
}

const PortalSettingsContext = createContext<PortalSettingsContextValue>({
  activeCurriculumYear:     "2027-28",
  activeCurriculumYearLong: "2027-2028",
  curriculumYears:          CURRICULUM_YEARS_SHORT,
  curriculumYearsLong:      CURRICULUM_YEARS_LONG,
  activeYearsListLong:      DEFAULT_ACTIVE_YEARS_LONG,
  activeYearsListShort:     DEFAULT_ACTIVE_YEARS_LONG.map(longToShort),
  courseFee:                35,
  membershipFee:            150,
  loading:                  true,
  setActiveCurriculumYear:  async () => {},
  setActiveYearLocally:     () => {},
});

export function PortalSettingsProvider({ children }: { children: React.ReactNode }) {
  const [activeYear,      setActiveYear]      = useState("2027-28");
  const [activeYearsLong, setActiveYearsLong] = useState<string[]>(DEFAULT_ACTIVE_YEARS_LONG);
  const [courseFee,       setCourseFee]       = useState(35);
  const [membershipFee,   setMembershipFee]   = useState(150);
  const [loading,         setLoading]         = useState(true);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/settings`)
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        if (data.active_curriculum_year)        setActiveYear(data.active_curriculum_year);
        if (data.stripe_course_fee)             setCourseFee(parseFloat(data.stripe_course_fee));
        if (data.stripe_membership_fee)         setMembershipFee(parseFloat(data.stripe_membership_fee));
        if (data.active_curriculum_years_list) {
          const parsed = data.active_curriculum_years_list
            .split(",").map((y: string) => y.trim()).filter(Boolean);
          if (parsed.length) setActiveYearsLong(parsed);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const setActiveCurriculumYear = useCallback(async (year: string) => {
    setActiveYear(year);
    await fetch(`${import.meta.env.BASE_URL}api/admin/settings`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json", "x-user-role": "admin" },
      body:    JSON.stringify({ key: "active_curriculum_year", value: year }),
    });
  }, []);

  const setActiveYearLocally = useCallback((shortYear: string) => {
    setActiveYear(shortYear);
  }, []);

  return (
    <PortalSettingsContext.Provider value={{
      activeCurriculumYear:     activeYear,
      activeCurriculumYearLong: shortToLong(activeYear),
      curriculumYears:          CURRICULUM_YEARS_SHORT,
      curriculumYearsLong:      CURRICULUM_YEARS_LONG,
      activeYearsListLong:      activeYearsLong,
      activeYearsListShort:     activeYearsLong.map(longToShort),
      courseFee,
      membershipFee,
      loading,
      setActiveCurriculumYear,
      setActiveYearLocally,
    }}>
      {children}
    </PortalSettingsContext.Provider>
  );
}

export function usePortalSettings() {
  return useContext(PortalSettingsContext);
}
