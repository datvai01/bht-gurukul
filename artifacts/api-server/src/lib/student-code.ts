export function formatStudentCode(number: number): string {
  return `GK-${String(number).padStart(3, "0")}`;
}

// Call inside a database transaction. The lock must be held until save has
// finished, so another registration cannot read the same maximum code.
export async function allocateStudentCode<T>(
  requestedCode: string | undefined,
  acquireLock: () => Promise<void>,
  highestNumber: () => Promise<number>,
  save: (code: string) => Promise<T>,
): Promise<T> {
  await acquireLock();
  const code = requestedCode || formatStudentCode((await highestNumber()) + 1);
  return save(code);
}