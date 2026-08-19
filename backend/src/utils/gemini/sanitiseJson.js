export function sanitizeForGemini(node) {
  if (Array.isArray(node)) return node.map(sanitizeForGemini);
  if (node === null || typeof node !== 'object') return node;

  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'additionalProperties' || k === 'default') continue;
    if (k === 'enum' && Array.isArray(v) && v.some((x) => typeof x !== 'string')) continue;
    if (k === 'oneOf') { out.anyOf = sanitizeForGemini(v); continue; }
    out[k] = sanitizeForGemini(v);
  }

  // literal 1|2|3 collapses to a bare number once the enum is stripped
  if (Array.isArray(out.anyOf)) {
    const kinds = new Set(out.anyOf.map((x) => x && x.type));
    if (kinds.size === 1 && !out.anyOf.some((x) => x && x.properties)) {
      const only = [...kinds][0];
      if (only) { delete out.anyOf; out.type = only; }
    }
  }

  // array length limits are rejected when items is a union
  if (out.type === 'array' && out.items && Array.isArray(out.items.anyOf)) {
    delete out.minItems;
    delete out.maxItems;
  }
  return out;
}