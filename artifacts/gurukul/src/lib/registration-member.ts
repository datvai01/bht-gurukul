export type RegistrationMemberDetails = {
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
      saved.name !== details.name ||
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
  remember({ ...details, ...created });
  return created.id;
}