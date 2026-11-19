/* DECISION: a collapsed card shows three features, and the feature arrays are built from a COMMON
   part: Pro, Pro Brand and Studio began with the same three (unlimited gallery, unlimited clients,
   no watermark), so on the chooser the higher plan looked poorer than the cheaper one, because the
   differentiating items (salon team, full history, pin pools) were cut off. That breaks the owner
   rule that the decoy must not anti-sell. So features NO cheaper tier has go first and the rest
   follow in original order, keeping the card full. This is NOT an "everything from Pro" pointer
   (the owner forbade it): the full list stays, only the ORDER changes. Comparison is by the
   rendered text, not the i18n key, because the array carries translated strings; a semantic twin
   with two different texts ("Nieograniczona galeria" in Pro vs "Nieograniczone zdjęcia" in Studio)
   counts as a difference, knowingly: the item belongs to the plan anyway and certainty would mean
   rewriting the pricing hook's contract. */
export function collapsedFirst(
  features: readonly string[],
  cheaper: ReadonlySet<string> | undefined
): readonly string[] {
  if (cheaper === undefined || cheaper.size === 0) {
    return features;
  }
  const own = features.filter(f => !cheaper.has(f));
  const shared = features.filter(f => cheaper.has(f));
  return [...own, ...shared];
}
