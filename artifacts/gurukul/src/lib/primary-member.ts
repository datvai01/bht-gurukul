export type PrimaryMemberRole = "mother" | "father";

export type ParentDetails = {
  name: string;
  phone: string;
  email: string;
  employer: string;
};

export type MemberDetails = {
  name: string | null;
  phone: string | null;
  email: string | null;
  employer?: string | null;
};

export function resolveParentDetails(
  role: PrimaryMemberRole | null,
  member: MemberDetails | null,
  mother: ParentDetails,
  father: ParentDetails,
): { mother: ParentDetails; father: ParentDetails } {
  if (!role || !member) return { mother, father };
  const selected = role === "mother" ? mother : father;
  const primary = {
    name: member.name?.trim() || selected.name,
    phone: member.phone?.trim() || selected.phone,
    email: member.email?.trim() || selected.email,
    employer: member.employer?.trim() || selected.employer,
  };
  return role === "mother" ? { mother: primary, father } : { mother, father: primary };
}