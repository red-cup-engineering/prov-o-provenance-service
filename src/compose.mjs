import { admitManifest, compare, refusal } from "./manifest.mjs";

const LISTS = new Set(["used", "generated", "wasAssociatedWith", "wasDerivedFrom", "wasAttributedTo"]);

/** A stable key for a list member, so identical members merge and the merged list has one order. */
function memberKey(member) {
  return typeof member === "string" ? member : JSON.stringify(member, Object.keys(member).sort());
}

/** Merge two declarations of the same id: list fields are unioned, scalar fields must agree. */
function mergeDeclaration(kind, left, right) {
  const merged = { ...left };
  for (const [field, value] of Object.entries(right)) {
    if (!(field in merged)) {
      merged[field] = value;
    } else if (LISTS.has(field)) {
      const byKey = new Map([...merged[field], ...value].map((member) => [memberKey(member), member]));
      merged[field] = [...byKey.keys()].sort(compare).map((key) => byKey.get(key));
    } else if (JSON.stringify(merged[field]) !== JSON.stringify(value)) {
      return { conflict: `${kind} ${left.id} declares ${field} twice with different values` };
    }
  }
  return { merged };
}

/**
 * Compose provenance manifest fragments into one manifest: the build receipt a renderer writes, the people
 * and organizations a paper declares as data, the activities of its analysis. Declarations sharing an id merge;
 * the result is ordered by id, so the same fragments in any order compose to the same bytes.
 * @param {{fragments: object[], baseIri?: string}} request
 * @returns {{ok: true, manifest: object} | {ok: false, refusal: object}}
 */
export function composeProvenanceManifest(request) {
  if (request === null || typeof request !== "object" || !Array.isArray(request.fragments) || request.fragments.length === 0) {
    return refusal("InvalidRequest", "request must carry a non-empty fragments array");
  }
  const bases = new Set(request.fragments.map((fragment) => fragment?.baseIri).filter((base) => base !== undefined));
  if (request.baseIri === undefined && bases.size > 1) {
    return refusal("ConflictingBaseIri", `fragments name ${bases.size} different baseIri values; pass baseIri to choose one`);
  }
  const composed = { baseIri: request.baseIri ?? [...bases][0], agents: new Map(), activities: new Map(), entities: new Map() };
  for (const [index, fragment] of request.fragments.entries()) {
    if (fragment === null || typeof fragment !== "object" || Array.isArray(fragment)) return refusal("InvalidRequest", `fragment ${index} must be an object`);
    for (const [kind, table] of [["agents", composed.agents], ["activities", composed.activities], ["entities", composed.entities]]) {
      for (const declaration of fragment[kind] ?? []) {
        const previous = table.get(declaration?.id);
        if (previous === undefined) {
          table.set(declaration?.id, declaration);
          continue;
        }
        const { merged, conflict } = mergeDeclaration(kind.slice(0, -1).replace(/ie$/u, "y"), previous, declaration);
        if (conflict) return refusal("ConflictingDeclaration", conflict);
        table.set(declaration.id, merged);
      }
    }
  }
  const ordered = (table) => [...table.values()].sort((a, b) => compare(String(a.id), String(b.id)));
  const manifest = {
    ...(composed.baseIri === undefined ? {} : { baseIri: composed.baseIri }),
    agents: ordered(composed.agents),
    activities: ordered(composed.activities),
    entities: ordered(composed.entities),
  };
  const admitted = admitManifest(manifest);
  return admitted.ok ? Object.freeze({ ok: true, manifest }) : admitted;
}
