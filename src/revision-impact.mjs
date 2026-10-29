/**
 * Pure impact screening over two ALREADY ADMITTED, CLOSED PROV manifests.
 * This is a conservative dependency readout; it cannot establish claim falsity.
 */
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonical = (x) => {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort(cmp).filter(k => x[k] !== undefined).map(k => JSON.stringify(k) + ":" + canonical(x[k])).join(",") + "}";
  return JSON.stringify(x);
};
const list = (xs = []) => [...xs].sort(cmp);
const mapById = (xs) => new Map(xs.map(x => [x.id, x]));
const stableEntity = (e) => canonical({
  path: e.path, bytes: e.bytes, mediaType: e.mediaType,
  git: e.git ?? null, license: e.license ?? null,
  // Source-use guidance, attributed credit, and rights testimony are not
  // licenses. Compare their exact recorded values: a correction can require
  // review even when both the input bytes and license remain unchanged.
  rights: e.rights ?? null, usageInfo: e.usageInfo ?? null,
  creditText: e.creditText ?? null,
  wasAttributedTo: list(e.wasAttributedTo ?? []),
});
const stableAgent = (a) => canonical(a);
const stableActivity = (a) => canonical({
  ...a, used: list(a.used ?? []), generated: list(a.generated ?? []),
  wasAssociatedWith: [...(a.wasAssociatedWith ?? [])].map(canonical).sort(cmp),
});
function refuse(message) { return { ok: false, refusal: { reason: "ImpactInputInvalid", message } }; }

/** Call only AFTER both source manifests pass original schema/closure admission. */
export function analyzeAdmittedProvenanceRevision(previous, current, { rechecks = [] } = {}) {
  if (![previous, current].every(m => m && Array.isArray(m.entities) && Array.isArray(m.activities) && Array.isArray(m.agents))) {
    return refuse("both inputs must be admitted PROV manifest objects");
  }
  if ([previous, current].some(m => m.entities.length > 10_000 || m.activities.length > 5_000 || m.agents.length > 10_000)) {
    return { ok: false, refusal: { reason: "ImpactBudgetExceeded", message: "manifest count exceeds conservative impact bounds" } };
  }
  const estimatedEdges = [previous, current].reduce((count, manifest) => count +
    manifest.entities.reduce((n, item) => n + (item.wasDerivedFrom ?? []).length, 0) +
    manifest.activities.reduce((n, activity) => n + ((activity.used ?? []).length + (activity.plan ? 1 : 0)) * (activity.generated ?? []).length, 0), 0);
  if (estimatedEdges > 200_000) return { ok: false, refusal: { reason: "ImpactBudgetExceeded", message: "potential dependency edges exceed conservative impact bounds" } };
  const old = mapById(previous.entities), now = mapById(current.entities);
  const oldActs = mapById(previous.activities), nowActs = mapById(current.activities);
  const oldAgents = mapById(previous.agents), nowAgents = mapById(current.agents);
  for (const m of [previous, current]) {
    if (new Set(m.entities.map(e => e.id)).size !== m.entities.length ||
        new Set(m.activities.map(e => e.id)).size !== m.activities.length ||
        new Set(m.agents.map(e => e.id)).size !== m.agents.length) return refuse("duplicate logical IDs");
  }
  const graph = new Map(), inbound = [new Map(), new Map()];
  let edgeCount = 0;
  function edge(src, dst, kind, edition) {
    if (!src || !dst) return;
    if (!graph.has(src)) graph.set(src, new Map());
    const edgeKinds = graph.get(src);
    if (!edgeKinds.has(dst)) { edgeKinds.set(dst, new Set()); edgeCount += 1; }
    edgeKinds.get(dst).add(kind);
    if (!inbound[edition].has(dst)) inbound[edition].set(dst, new Set());
    inbound[edition].get(dst).add(src + "\u0000" + kind);
  }
  for (const [edition, manifest] of [[0, previous], [1, current]]) {
    const index = mapById(manifest.entities);
    const byNi = new Map(manifest.entities.map(e => [e.ni, e]));
    const lookup = (ref) => (index.get(ref) ?? byNi.get(ref))?.id;
    for (const item of manifest.entities) for (const ref of item.wasDerivedFrom ?? []) edge(lookup(ref), item.id, "prov:wasDerivedFrom", edition);
    for (const a of manifest.activities) {
      const inputs = [...(a.used ?? []).map(lookup).filter(Boolean), ...(a.plan ? [lookup(a.plan)] : [])].filter(Boolean);
      for (const dstRef of a.generated ?? []) {
        const dst = lookup(dstRef);
        for (const src of inputs) edge(src, dst, a.plan && src === lookup(a.plan) ? "prov:hadPlan" : "prov:used/wasGeneratedBy", edition);
      }
    }
  }
  if (edgeCount > 200_000) return { ok: false, refusal: { reason: "ImpactBudgetExceeded", message: "dependency edges exceed conservative impact bounds" } };

  const direct = new Map();
  function addReason(id, reason) {
    if (!direct.has(id)) direct.set(id, new Set());
    direct.get(id).add(reason);
  }
  if (!Array.isArray(rechecks) || rechecks.length > 128 ||
      rechecks.some(x => !x || !old.has(x.entityId) || !now.has(x.entityId) ||
        typeof x.propositionAddress !== "string")) {
    return refuse("recheck bindings must name stable original PROV entity ids");
  }
  const orderedRechecks = [...rechecks].sort((a,b) =>
    cmp(a.propositionAddress,b.propositionAddress) || cmp(a.entityId,b.entityId));
  const ids = [...new Set([...old.keys(), ...now.keys()])].sort(cmp);
  for (const id of ids) {
    const prior = old.get(id), latest = now.get(id);
    if (!prior) addReason(id, "entity-added");
    else if (!latest) addReason(id, "entity-removed");
    else {
      if (prior.ni !== latest.ni) addReason(id, "entity-bytes-changed");
      if (stableEntity(prior) !== stableEntity(latest)) addReason(id, "entity-provenance-or-rights-changed");
      const before = list(inbound[0].get(id) ?? []), after = list(inbound[1].get(id) ?? []);
      if (canonical(before) !== canonical(after)) addReason(id, "incoming-dependency-changed");
    }
  }
  // These are caller-mapped SignChain comparisons, not asserted entity revisions.
  // The same existing PROV dependency graph performs all downstream traversal.
  for (const { entityId } of orderedRechecks) addReason(entityId, "signchain-original-evidence-recheck");
  const changedActivities = [...new Set([...oldActs.keys(), ...nowActs.keys()])]
    .filter(id => canonical(oldActs.get(id) ? stableActivity(oldActs.get(id)) : null) !== canonical(nowActs.get(id) ? stableActivity(nowActs.get(id)) : null)).sort(cmp);
  const changedAgents = [...new Set([...oldAgents.keys(), ...nowAgents.keys()])]
    .filter(id => (oldAgents.has(id) ? stableAgent(oldAgents.get(id)) : null) !== (nowAgents.has(id) ? stableAgent(nowAgents.get(id)) : null)).sort(cmp);
  // Provenance responsibility extends through source-admitted prov:actedOnBehalfOf.
  // A principal's revised identity/accountability can require review of an
  // unchanged delegate's output. Retain both editions' delegation relations:
  // deleting a delegation must not hide its prior downstream consumers.
  const delegatedBy = new Map();
  for (const m of [previous, current]) for (const agent of m.agents) {
    if (!agent.actedOnBehalfOf) continue;
    if (!delegatedBy.has(agent.actedOnBehalfOf)) delegatedBy.set(agent.actedOnBehalfOf, new Set());
    delegatedBy.get(agent.actedOnBehalfOf).add(agent.id);
  }
  const responsibilityAffected = new Set(changedAgents);
  const delegationQueue = [...changedAgents];
  for (let i = 0; i < delegationQueue.length; i++) {
    for (const delegate of delegatedBy.get(delegationQueue[i]) ?? []) {
      if (responsibilityAffected.has(delegate)) continue;
      responsibilityAffected.add(delegate);
      delegationQueue.push(delegate);
    }
  }
  for (const m of [previous, current]) {
    const index = mapById(m.entities), byNi = new Map(m.entities.map(e => [e.ni, e]));
    const lookup = (ref) => (index.get(ref) ?? byNi.get(ref))?.id;
    for (const a of m.activities) {
      if (changedActivities.includes(a.id) || (a.wasAssociatedWith ?? []).some(x => responsibilityAffected.has(x.agent))) {
        for (const ref of a.generated ?? []) {
          const id = lookup(ref);
          if (id) addReason(id, changedActivities.includes(a.id) ? "generating-activity-changed" : "responsibility-changed");
        }
      }
    }
    for (const e of m.entities) if ((e.wasAttributedTo ?? []).some(id => responsibilityAffected.has(id))) addReason(e.id, "responsibility-changed");
  }
  const seeds = [...direct.keys()].sort(cmp), queue = [...seeds];
  const witness = new Map(seeds.map(id => [id, { source: id, path: [id], edgeKinds: [] }]));
  for (let i = 0; i < queue.length; i += 1) {
    const src = queue[i];
    const successors = [...(graph.get(src)?.entries() ?? [])].sort((a, b) => cmp(a[0], b[0]));
    for (const [dst, edgeKinds] of successors) {
      if (witness.has(dst)) continue;
      const ancestor = witness.get(src);
      witness.set(dst, { source: ancestor.source, path: [...ancestor.path, dst], edgeKinds: [...ancestor.edgeKinds, list(edgeKinds)] });
      queue.push(dst);
    }
  }
  const directChanges = seeds.map(id => ({
    id, reasons: list(direct.get(id)), previousNi: old.get(id)?.ni ?? null, currentNi: now.get(id)?.ni ?? null,
  }));
  const affected = [...witness.entries()].sort((a, b) => cmp(a[0], b[0])).map(([id, w]) => ({
    id, direct: direct.has(id), sourceOfChange: w.source, path: w.path, edgeKinds: w.edgeKinds,
    existsInCurrent: now.has(id), unchangedBytes: old.has(id) && now.has(id) && old.get(id).ni === now.get(id).ni,
  }));
  return {
    ok: true, type: "ProvenanceRevisionImpact", version: 1,
    disposition: seeds.length ? "candidate-reassessment-needed" : "no-affected-entities-detected",
    directChanges, changedActivities, changedAgents, responsibilityAffectedAgents: list(responsibilityAffected),
    reverificationBindings: orderedRechecks,
    affected, potentiallyStaleUnchanged: affected.filter(a => !a.direct && a.unchangedBytes).map(a => a.id),
    summary: { previousEntities: old.size, currentEntities: now.size, changedDirectly: seeds.length,
      candidateImpacts: affected.length, unchangedDependentCandidates: affected.filter(a => !a.direct && a.unchangedBytes).length },
    boundary: "Conservative PROV dependency influence or caller-declared original-evidence recheck; cannot authenticate a SignChain source, witness clock or proposition-to-entity binding, and cannot prove a false claim, legal disclosure right or research settlement. Independent scientific reassessment remains required.",
  };
}
