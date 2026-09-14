export function measureMessageRow(element: Element): number {
  return Math.ceil(element.getBoundingClientRect().height);
}

export function measureCommittedMessageRows(
  container: HTMLElement,
  itemKeys: readonly string[],
): Array<{ index: number; size: number }> {
  if (!container.isConnected || container.getClientRects().length === 0) return [];
  const measurements: Array<{ index: number; size: number }> = [];
  for (const row of Array.from(container.children)) {
    const index = Number(row.getAttribute("data-index"));
    if (!row.isConnected || !Number.isInteger(index) || index < 0 || index >= itemKeys.length) continue;
    if (row.getAttribute("data-item-key") !== itemKeys[index]) continue;
    measurements.push({ index, size: measureMessageRow(row) });
  }
  return measurements;
}
