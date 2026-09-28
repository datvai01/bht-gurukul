export type RegistrationMemberDetails = {
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  employer?: string;
};

export type SavedRegistrationMember = RegistrationMemberDetails & {
  id: number;
  memberCode?: string | null;
  memberContextToken?: string;
};

export async function ensureRegistrationMember(
  saved: SavedRegistrationMember | null,
  details: RegistrationMemberDetails,
  create: () => Promise<{ id: number; memberCode?: string | null; memberContextToken?: string }>,
  remember: (member: SavedRegistrationMember) => void,
): Promise<number> {
  if (saved) {
    if (
      saved.firstName !== details.firstName ||
      saved.lastName !== details.lastName ||
      saved.email !== details.email ||
      saved.phone !== details.phone ||
      saved.address !== details.address ||
      saved.employer !== details.employer
    ) {
      throw new Error("Your member record was saved, but its details have changed. Restore the original details or use the existing-member lookup to update them before retrying.");
    }
    return saved.id;
  }

  const created = await create();
  // Keep the submitted details as the retry baseline; the server's normalized row
  // (e.g. employer null for a blank entry) must not make an unchanged retry look edited.
  remember({ ...details, id: created.id, memberCode: created.memberCode, memberContextToken: created.memberContextToken });
  return created.id;
}