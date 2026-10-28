// Session rail card order (cdae9a994 J / L, cf74bc599 FA): pure helpers behind Rail.tsx.

/**
 * The cards in their saved order: the saved ones fill their own default slots in the saved
 * sequence and the rest keep theirs, so a card the saved order has never seen lands where it
 * would by default.
 */
export function railOrder<T extends string>(defaults: readonly T[], saved: readonly string[]): T[] {
  const known = new Set<string>(defaults);
  const queue = [...new Set(saved)].filter((id): id is T => known.has(id));
  const kept = new Set<string>(queue);
  return defaults.map((id) => (kept.has(id) ? queue.shift()! : id));
}

/** dnd-kit's arrayMove: `from` taken out and put back at `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Same ids in the same order. */
export const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => b[index] === id);
