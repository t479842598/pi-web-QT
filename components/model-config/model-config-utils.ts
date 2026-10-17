/**
 * Pure list math for the "discover models first" provider form.
 *
 * WHY this is separate from the components: every one of these functions feeds
 * `models.json` (or the slot map that decides what counts as a rename), so they
 * have to be testable without React and without a DOM.
 */

export interface ModelRef {
  id: string;
  name?: string;
}

/**
 * Reorders `models` so it follows `orderedIds`, keeping anything the user never
 * touched at the tail in its original order.
 * WHY the tail survives: a discovered model that is temporarily filtered out of
 * the right-hand pane is still selected; dropping it would silently delete a
 * model from the provider entry.
 */
export function applyModelOrder<T extends { id: string }>(models: readonly T[], orderedIds: readonly string[]): T[] {
  const byId = new Map<string, T>();
  for (const model of models) {
    if (!byId.has(model.id)) byId.set(model.id, model);
  }
  const out: T[] = [];
  const used = new Set<string>();
  for (const id of orderedIds) {
    const model = byId.get(id);
    if (!model || used.has(id)) continue;
    used.add(id);
    out.push(model);
  }
  for (const model of models) {
    if (used.has(model.id)) continue;
    used.add(model.id);
    out.push(model);
  }
  return out;
}

/**
 * Re-points the saved-slot map at a reordered model list.
 *
 * WHY this is mandatory rather than cosmetic: `collectModelRenames()` compares
 * `saved[index]` with `models[index].id`. After a pure drag, `[a,b,c]` becomes
 * `[c,a,b]`, which that comparison reads as three renames (`a→c`, `b→a`,
 * `c→b`) and `enabledModels.resync()` then rewrites three entries that never
 * changed. Carrying each saved id to its new position is what keeps the drag
 * invisible to the save path.
 *
 * `null` is a slot for a model added since the last save: it is not an id, so
 * it cannot be looked up, and it simply keeps a free null slot. A model id the
 * map has never seen also takes a free null slot.
 *
 * `previousIds` exists for one case the two-argument form cannot express: a
 * model renamed in place by the detail editor. The slot still spells the old
 * id, so looking the new id up would find nothing and the rename would be
 * lost. Passing the draft's ids *as they were before this reorder*, positionally
 * against `saved`, keys the lookup by what the form currently shows while
 * keeping the saved spelling as the value — so a rename survives a reorder and
 * `collectModelRenames()` still sees `old→new`.
 */
export function syncSlotsAfterReorder(
  saved: (string | null)[] | undefined,
  orderedIds: readonly (string | null | undefined)[],
  previousIds?: readonly (string | null | undefined)[],
): (string | null)[] | undefined {
  if (!saved) return undefined;

  const slotByKey = new Map<string, string>();
  let freeNullSlots = 0;
  saved.forEach((slot, index) => {
    if (slot === null || slot === "") {
      freeNullSlots += 1;
      return;
    }
    const key = previousIds?.[index] ?? slot;
    if (typeof key === "string" && key !== "" && !slotByKey.has(key)) slotByKey.set(key, slot);
  });

  const out: (string | null)[] = [];
  for (const id of orderedIds) {
    if (id === null || id === undefined || id === "") {
      out.push(null);
      if (freeNullSlots > 0) freeNullSlots -= 1;
      continue;
    }
    const known = slotByKey.get(id);
    if (known !== undefined) {
      out.push(known);
      continue;
    }
    if (freeNullSlots > 0) freeNullSlots -= 1;
    out.push(null);
  }
  return out;
}

/**
 * Merges a discovery result into the draft's selected models.
 * WHY case-insensitive: providers disagree about the case of the same id
 * (`GPT-4o` vs `gpt-4o`), and appending both would write a duplicate entry that
 * the runtime rejects at load time.
 */
export function mergeDiscoveredModels<T extends { id: string }>(
  existing: readonly T[],
  discovered: readonly ModelRef[],
): { models: T[]; added: number } {
  const seen = new Set(existing.map((model) => model.id.toLocaleLowerCase()));
  const models: T[] = [...existing];
  let added = 0;
  for (const model of discovered) {
    const key = model.id.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    models.push({ id: model.id, ...(model.name ? { name: model.name } : {}) } as T);
    added += 1;
  }
  return { models, added };
}

/**
 * The model a provider entry treats as its default: the first one, in order.
 * WHY the form's order is the contract: the setup sheet writes the list top to
 * bottom and users read the top row as "the one that gets used".
 */
export function primaryModelId(models: readonly { id: string }[]): string | undefined {
  for (const model of models) {
    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (id) return id;
  }
  return undefined;
}

/** Case-insensitive membership test used by every pane's checkbox. */
export function containsModelId(models: readonly { id: string }[], id: string): boolean {
  const wanted = id.trim().toLocaleLowerCase();
  if (!wanted) return false;
  return models.some((model) => model.id.trim().toLocaleLowerCase() === wanted);
}
