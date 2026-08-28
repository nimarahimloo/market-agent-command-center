export function ownerScoped<T extends { ownerId: number }>(rows: readonly T[], ownerId: number): T[] {
  return rows.filter(row => row.ownerId === ownerId);
}
