import type { enrollmentsTable } from "@workspace/db";

type EnrollmentStatus = typeof enrollmentsTable.$inferSelect.status;

export function returningEnrollmentConflictMessage(statuses: readonly EnrollmentStatus[]): string | null {
  if (statuses.length === 0) return null;
  if (statuses.some(status => status !== "Withdrawn")) {
    return "This student already has an enrollment for one of the selected course levels. Review the existing registration before adding another.";
  }
  return "This student has a withdrawn enrollment for one of the selected course levels. Contact the temple office to reactivate it.";
}