import { db } from "@workspace/db";
import {
  coursesTable,
  courseLevelsTable,
  enrollmentsTable,
  membersTable,
  membershipPaymentsTable,
  paymentsTable,
  studentRegistrationsTable,
  studentsTable,
} from "@workspace/db/schema";
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { templeYear } from "./membership";

// Recorded on unpaid rows so the Temple Administration Desk knows what is expected.
export const TEMPLE_DESK_PAYMENT = "Temple Desk Payment";
export const TEMPLE_DESK_VALIDATION_PAYMENT = "Temple Desk Validation/Payment";

type Executor = Pick<typeof db, "select" | "update">;

export type BalanceItem = {
  kind: "course" | "membership";
  id: number;
  label: string;
  amountDue: number;
  amountPaid: number;
  balance: number;
  pendingReason: string | null;
};

export type RegistrationBalance = {
  studentId: number;
  studentCode: string;
  memberId: number;
  curriculumYear: string;
  memberValidated: boolean;
  // Online payment is offered only after BHT administration has validated the member.
  onlinePaymentEligible: boolean;
  items: BalanceItem[];
  total: number;
};

// An administrator-configured fee; null when missing or invalid (fees are never assumed).
export function configuredFee(value: string | null | undefined): number | null {
  if (value == null || !value.trim()) return null;
  const fee = Number(value.trim());
  return Number.isFinite(fee) && fee >= 0 ? Math.round(fee * 100) / 100 : null;
}

export function isValidatedMember(validationStatus: string | null | undefined): boolean {
  return validationStatus?.trim().toLowerCase() === "validated";
}

function money(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

// Outstanding fees for a student's latest registration plus the linked member's
// unpaid membership years (current and advance). Null when nothing is linked.
export async function registrationBalance(
  executor: Executor,
  studentCode: string,
  memberId?: number,
): Promise<RegistrationBalance | null> {
  const [student] = await executor.select({
    id: studentsTable.id,
    studentCode: studentsTable.studentCode,
    memberId: studentsTable.memberId,
    validationStatus: membersTable.validationStatus,
  }).from(studentsTable)
    .innerJoin(membersTable, eq(membersTable.id, studentsTable.memberId))
    .where(and(
      eq(studentsTable.studentCode, studentCode),
      ...(memberId !== undefined ? [eq(studentsTable.memberId, memberId)] : []),
    ))
    .limit(1);
  if (!student?.memberId) return null;

  const [registration] = await executor.select({
    id: studentRegistrationsTable.id,
    curriculumYear: studentRegistrationsTable.curriculumYear,
  }).from(studentRegistrationsTable)
    .where(eq(studentRegistrationsTable.studentId, student.id))
    .orderBy(desc(studentRegistrationsTable.id))
    .limit(1);
  if (!registration) return null;

  const courseRows = await executor.select({
    id: paymentsTable.id,
    courseName: coursesTable.name,
    className: courseLevelsTable.className,
    amountDue: paymentsTable.amountDue,
    amountPaid: paymentsTable.amountPaid,
    pendingReason: paymentsTable.pendingReason,
  }).from(enrollmentsTable)
    .innerJoin(paymentsTable, eq(paymentsTable.enrollmentId, enrollmentsTable.id))
    .innerJoin(courseLevelsTable, eq(courseLevelsTable.id, enrollmentsTable.courseLevelId))
    .innerJoin(coursesTable, eq(coursesTable.id, courseLevelsTable.courseId))
    .where(and(
      eq(enrollmentsTable.registrationId, registration.id),
      eq(enrollmentsTable.status, "Enrolled"),
    ))
    .orderBy(coursesTable.name);

  const membershipRows = await executor.select({
    id: membershipPaymentsTable.id,
    membershipYear: membershipPaymentsTable.membershipYear,
    amountDue: membershipPaymentsTable.amountDue,
    amountPaid: membershipPaymentsTable.amountPaid,
    pendingReason: membershipPaymentsTable.pendingReason,
  }).from(membershipPaymentsTable)
    .where(and(
      eq(membershipPaymentsTable.memberId, student.memberId),
      gte(membershipPaymentsTable.membershipYear, templeYear()),
      ne(membershipPaymentsTable.paymentStatus, "Paid"),
    ))
    .orderBy(membershipPaymentsTable.membershipYear);

  const items: BalanceItem[] = [
    ...membershipRows.map(row => ({
      kind: "membership" as const,
      id: row.id,
      label: `Annual Temple Membership (${row.membershipYear})`,
      amountDue: money(row.amountDue),
      amountPaid: money(row.amountPaid),
      balance: Math.max(0, money(row.amountDue) - money(row.amountPaid)),
      pendingReason: row.pendingReason,
    })),
    ...courseRows.map(row => ({
      kind: "course" as const,
      id: row.id,
      label: `${row.courseName} · ${row.className}`,
      amountDue: money(row.amountDue),
      amountPaid: money(row.amountPaid),
      balance: Math.max(0, money(row.amountDue) - money(row.amountPaid)),
      pendingReason: row.pendingReason,
    })),
  ];
  const memberValidated = isValidatedMember(student.validationStatus);
  return {
    studentId: student.id,
    studentCode: student.studentCode,
    memberId: student.memberId,
    curriculumYear: registration.curriculumYear,
    memberValidated,
    onlinePaymentEligible: memberValidated,
    items,
    total: money(items.reduce((sum, item) => sum + item.balance, 0)),
  };
}

// Marks every outstanding row of a balance with the reason it is waiting at the Temple Desk.
export async function markTempleDeskPending(executor: Executor, balance: RegistrationBalance): Promise<string> {
  const reason = balance.memberValidated ? TEMPLE_DESK_PAYMENT : TEMPLE_DESK_VALIDATION_PAYMENT;
  const outstanding = balance.items.filter(item => item.balance > 0);
  const courseIds = outstanding.filter(item => item.kind === "course").map(item => item.id);
  const membershipIds = outstanding.filter(item => item.kind === "membership").map(item => item.id);
  if (courseIds.length) {
    await executor.update(paymentsTable).set({ pendingReason: reason }).where(inArray(paymentsTable.id, courseIds));
  }
  if (membershipIds.length) {
    await executor.update(membershipPaymentsTable).set({ pendingReason: reason })
      .where(inArray(membershipPaymentsTable.id, membershipIds));
  }
  return reason;
}

// A paid membership year (including an advance year) extends the membership through its December 31.
export async function extendMembershipThrough(executor: Executor, memberId: number, year: number): Promise<void> {
  await executor.update(membersTable)
    .set({ membershipYear: sql`GREATEST(COALESCE(${membersTable.membershipYear}, 0), ${year})` })
    .where(eq(membersTable.id, memberId));
}
