/**
 * Update an oldest-to-newest list of resident video ids. The current clip and
 * immediate neighbours are touched on every step; older clips remain mounted
 * until the bounded pool needs to evict them.
 */
export function updateVideoPool(
  itemIds: string[],
  currentIndex: number,
  residentIds: string[],
  limit = 6
): string[] {
  if (itemIds.length === 0) return []
  const valid = new Set(itemIds)
  const current = Math.min(Math.max(currentIndex, 0), itemIds.length - 1)
  const touched = [itemIds[current - 1], itemIds[current + 1], itemIds[current]].filter(
    (id): id is string => Boolean(id)
  )
  const touchedSet = new Set(touched)
  const next = residentIds.filter((id) => valid.has(id) && !touchedSet.has(id))
  next.push(...touched)
  while (next.length > Math.max(3, limit)) next.shift()
  return next
}
