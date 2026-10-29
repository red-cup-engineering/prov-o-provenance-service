import { admitManifest, compare, indexManifest, refusal } from "./manifest.mjs";
import { analyzeAdmittedProvenanceRevision } from "./revision-impact.mjs";

const error = (kind, subject, message, reference) => ({ kind, severity: "error", subject, ...(reference === undefined ? {} : { reference }), message });
const warning = (kind, subject, message, reference) => ({ kind, severity: "warning", subject, ...(reference === undefined ? {} : { reference }), message });

function duplicates(values) {
  const seen = new Set(), repeated = new Set();
  for (const value of values) (seen.has(value) ? repeated : seen).add(value);
  return [...repeated];
}

function cycleMembers(edges) {
  // Iterative three-colour DFS; returns the ids that lie on a cycle (including self-loops).
  const state = new Map(), onCycle = new Set();
  for (const root of edges.keys()) {
    if (state.has(root)) continue;
    const stack = [[root, 0]], path = [root];
    state.set(root, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const successors = edges.get(frame[0]) ?? [];
      if (frame[1] < successors.length) {
        const next = successors[frame[1]++];
        if (!edges.has(next)) continue;
        if (state.get(next) === 1) for (const id of path.slice(path.indexOf(next))) onCycle.add(id);
        else if (!state.has(next)) { state.set(next, 1); stack.push([next, 0]); path.push(next); }
      } else { state.set(frame[0], 2); stack.pop(); path.pop(); }
    }
  }
  return onCycle;
}

/**
 * Report every way an admitted manifest fails to close as a provenance record. Pure: no
 * reading, no clock. `closed` holds when no gap has severity "error".
 */
export function provenanceGaps(manifest) {
  const index = indexManifest(manifest);
  const gaps = [];
  const agent = (id) => ({ type: "agent", id }), activity = (id) => ({ type: "activity", id }), entity = (id) => ({ type: "entity", id });

  for (const id of duplicates(manifest.agents.map((item) => item.id))) gaps.push(error("duplicate-id", agent(id), `agent id ${id} is declared more than once`));
  for (const id of duplicates(manifest.activities.map((item) => item.id))) gaps.push(error("duplicate-id", activity(id), `activity id ${id} is declared more than once`));
  for (const id of duplicates(manifest.entities.map((item) => item.id))) gaps.push(error("duplicate-id", entity(id), `entity id ${id} is declared more than once`));
  // NI names bytes, not a uniquely witnessed source *occurrence*. Distinct
  // declarations can legitimately share bytes, but RDF projection identifies
  // them as one subject. Do not project contradictory source-use assertions
  // onto that subject, or silently pick one logical source for an NI reference.
  const declarationsByNi = new Map();
  for (const item of manifest.entities) {
    if (!declarationsByNi.has(item.ni)) declarationsByNi.set(item.ni, []);
    declarationsByNi.get(item.ni).push(item);
  }
  const sharedNi = new Set();
  const rightsSignature = item => JSON.stringify(["license", "rights", "usageInfo", "creditText"]
    .map(key => item[key] ?? null));
  for (const [ni, declarations] of declarationsByNi) {
    if (declarations.length < 2) continue;
    sharedNi.add(ni);
    const paths = declarations.map(item => item.path).sort(compare);
    gaps.push(warning("entity-address-shared", entity(ni),
      `entities ${paths.join(", ")} share one content address and are one RDF entity`));
    if (new Set(declarations.map(rightsSignature)).size > 1) {
      gaps.push(error("shared-content-rights-conflict", entity(ni),
        `the same content address has differing license, rights, usageInfo or creditText; RDF projection would conflate source-specific testimony`));
    }
  }
  const checkSourceReference = (reference, subject) => {
    // A uniquely named logical ID is qualified even when another file has
    // the same bytes. Bare NI lookup is not: indexManifest's first match and
    // the historical impact reader's last match could disagree by row order.
    if (sharedNi.has(reference) && !index.entitiesById.has(reference)) {
      const ids = declarationsByNi.get(reference).map(item => item.id).sort(compare);
      gaps.push(error("ambiguous-content-address-reference", subject,
        `content address matches multiple logical source identities (${ids.join(", ")}); use an exact entity id rather than an ambiguous ni: reference`, reference));
    }
  };

  const generatedBy = new Map();
  for (const item of manifest.activities) {
    const started = Date.parse(item.startedAt), ended = Date.parse(item.endedAt);
    if (!Number.isFinite(started) || !Number.isFinite(ended)) gaps.push(error("activity-time-invalid", activity(item.id), "startedAt or endedAt is not a real instant"));
    else if (ended < started) gaps.push(error("activity-ends-before-start", activity(item.id), `endedAt ${item.endedAt} precedes startedAt ${item.startedAt}`));
    for (const reference of item.used) {
      checkSourceReference(reference, activity(item.id));
      if (index.entity(reference) === undefined) gaps.push(error("used-entity-undeclared", activity(item.id), `activity uses ${reference}, which no entity declares`, reference));
    }
    for (const reference of item.generated) {
      checkSourceReference(reference, activity(item.id));
      const found = index.entity(reference);
      if (found === undefined) { gaps.push(error("generated-entity-undeclared", activity(item.id), `activity generated ${reference}, which no entity declares`, reference)); continue; }
      if (!generatedBy.has(found.id)) generatedBy.set(found.id, []);
      generatedBy.get(found.id).push(item.id);
    }
    for (const association of item.wasAssociatedWith) {
      if (!index.agents.has(association.agent)) gaps.push(error("association-agent-undeclared", activity(item.id), `activity is associated with ${association.agent}, which no agent declares`, association.agent));
    }
    if (item.plan !== undefined) {
      checkSourceReference(item.plan, activity(item.id));
      if (index.entity(item.plan) === undefined) gaps.push(error("plan-undeclared", activity(item.id), `activity follows plan ${item.plan}, which no entity declares`, item.plan));
      if (item.wasAssociatedWith.length === 0) gaps.push(warning("plan-without-association", activity(item.id), "activity names a plan but no associated agent followed it, so hadPlan cannot be stated"));
    }
  }

  const delegations = new Map();
  for (const item of manifest.agents) {
    if (item.actedOnBehalfOf !== undefined) {
      if (!index.agents.has(item.actedOnBehalfOf)) gaps.push(error("delegation-agent-undeclared", agent(item.id), `agent acted on behalf of ${item.actedOnBehalfOf}, which no agent declares`, item.actedOnBehalfOf));
      delegations.set(item.id, [item.actedOnBehalfOf]);
    }
    if (item.kind === "ai-system" && item.actedOnBehalfOf === undefined) gaps.push(warning("ai-system-without-accountable-agent", agent(item.id), "an ai-system agent names no accountable person or organization"));
  }
  for (const id of [...cycleMembers(delegations)].sort(compare)) gaps.push(error("delegation-cycle", agent(id), `agent ${id} is on a delegation cycle`));

  const derivations = new Map();
  for (const item of manifest.entities) {
    const sources = [];
    for (const reference of item.wasDerivedFrom) {
      checkSourceReference(reference, entity(item.id));
      const found = index.entity(reference);
      if (found === undefined) gaps.push(error("derivation-unresolved", entity(item.id), `entity derives from ${reference}, which no entity declares`, reference));
      else sources.push(found.id);
    }
    derivations.set(item.id, sources);
    for (const reference of item.wasAttributedTo) {
      if (!index.agents.has(reference)) gaps.push(error("attribution-agent-undeclared", entity(item.id), `entity is attributed to ${reference}, which no agent declares`, reference));
    }
    const generators = generatedBy.get(item.id) ?? [];
    if (item.wasDerivedFrom.length > 0 && generators.length === 0) {
      gaps.push(error("derived-entity-without-generating-activity", entity(item.id), "entity has derivations but no activity generated it"));
    }
    if (generators.length > 1) gaps.push(warning("entity-generated-by-multiple-activities", entity(item.id), `entity is generated by ${[...generators].sort(compare).join(", ")}`));
    for (const sourceId of sources) {
      const used = generators.some((generatorId) => {
        const generator = index.activities.get(generatorId);
        return generator.used.some((reference) => index.entity(reference)?.id === sourceId);
      });
      if (generators.length > 0 && !used) gaps.push(warning("derivation-not-used-by-generator", entity(item.id), `derived from ${sourceId} but no generating activity used it`, sourceId));
    }
  }
  for (const id of [...cycleMembers(derivations)].sort(compare)) gaps.push(error("derivation-cycle", entity(id), `entity ${id} is on a derivation cycle`));

  gaps.sort((left, right) => compare(left.kind, right.kind) || compare(left.subject.id, right.subject.id) || compare(left.reference ?? "", right.reference ?? ""));
  const roots = manifest.entities.filter((item) => !generatedBy.has(item.id)).map((item) => item.id).sort(compare);
  const errors = gaps.filter((gap) => gap.severity === "error").length;
  return { closed: errors === 0, gaps, summary: { agents: manifest.agents.length, activities: manifest.activities.length, entities: manifest.entities.length, roots, errors, warnings: gaps.length - errors } };
}

/**
 * Check that a build provenance manifest closes: every derived entity has a generating
 * activity, every used or generated entity is declared, every derivation, attribution,
 * association, delegation and plan resolves.
 * @param {object} manifest A build provenance manifest.
 * @returns {{ok: true, closed: boolean, gaps: object[], summary: object}|{ok: false, refusal: object}}
 */
export function checkProvenanceClosure(manifest) {
  const admitted = admitManifest(manifest);
  if (!admitted.ok) return admitted;
  return Object.freeze({ ok: true, ...provenanceGaps(admitted.manifest) });
}

/**
 * Compare two source-closed PROV-O manifest editions with stable logical IDs.
 * Only signals downstream objects requiring scientific review; does not prove false claims.
 * Uses the existing schema admission and closure checks before graph traversal.
 */
export function assessProvenanceRevisionImpact({ previous, current } = {}) {
  const earlier = admitManifest(previous);
  if (!earlier.ok) return refusal("InvalidPreviousManifest", earlier.refusal.message);
  const later = admitManifest(current);
  if (!later.ok) return refusal("InvalidCurrentManifest", later.refusal.message);
  if (earlier.manifest.baseIri !== later.manifest.baseIri) {
    return refusal("IncompatibleManifestBases", "manifest editions do not share the same logical entity namespace");
  }
  for (const [edition, manifest] of [["previous", earlier.manifest], ["current", later.manifest]]) {
    const closure = provenanceGaps(manifest);
    if (!closure.closed) return refusal("ProvenanceNotClosed", edition + " manifest contains unresolved provenance", { edition, gaps: closure.gaps.filter(g => g.severity === "error") });
  }
  return analyzeAdmittedProvenanceRevision(earlier.manifest, later.manifest);
}
