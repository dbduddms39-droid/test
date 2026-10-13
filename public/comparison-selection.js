// UI-only comparison choice: keep every registered document in the record,
// but pass exactly two analyzed documents to comparison and question generation.
// Nothing here changes saved document content or calls AI.
export function comparisonPair(documents, preferred = []) {
  const available = (documents ?? []).filter((d) => d.analysis).map((d) => d.id);
  if (available.length < 2) return available;
  const ids = Array.isArray(preferred) ? preferred : [];
  const valid = ids.length === 2 && ids[0] !== ids[1] && ids.every((id) => available.includes(id));
  return valid ? [...ids] : available.slice(0, 2);
}

export function comparisonView(record, preferred = []) {
  const available = (record?.documents ?? []).filter((d) => d.analysis);
  if (available.length < 2) return record;
  const pair = comparisonPair(record.documents, preferred);
  // Preserve original registered order, even when the dropdowns show the pair in reverse order.
  const chosen = new Set(pair);
  return { ...record, documents: record.documents.filter((d) => chosen.has(d.id)) };
}

export function replaceComparedDocument(currentPair, side, docId, documents) {
  const all = (documents ?? []).filter((d) => d.analysis).map((d) => d.id);
  const pair = comparisonPair(documents, currentPair);
  if (side !== 0 && side !== 1) return pair;
  if (!all.includes(docId) || docId === pair[1 - side]) return pair;
  const next = [...pair];
  next[side] = docId;
  return next;
}
