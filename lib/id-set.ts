/**
 * Set-equality for id sets. The running-session poll fires every 2.5s and
 * rebuilds a Set each time; passing a new-but-identical Set to setState
 * would re-render the entire session tree for nothing. Returning the
 * previous reference when contents match lets React bail out.
 */
export function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
