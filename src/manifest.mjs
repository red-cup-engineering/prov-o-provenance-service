import { validateJsonSchema } from "@red-cup-engineering/json-schema-services-section/validation";
import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import manifestSchema from "../data/records/schema/provenance-manifest.schema.json" with { type: "json" };

export { manifestSchema };

export const DEFAULT_BASE_IRI = "urn:provenance:";

/** A domain refusal: the operation understood the request and declines it. */
export function refusal(reason, message, extra = {}) {
  return Object.freeze({ ok: false, refusal: Object.freeze({ reason, message, ...extra }) });
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

/** An id with a URI scheme is its own IRI; any other id is minted under baseIri by kind. */
export function mintIri(baseIri, kind, id) {
  return SCHEME.test(id) ? id : `${baseIri}${kind}/${encodeURIComponent(id)}`;
}

/** Admit a manifest against the schema; returns the manifest with defaults filled, or a refusal. */
export function admitManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return refusal("InvalidManifest", "manifest must be a JSON object");
  }
  const result = validateJsonSchema(manifest, manifestSchema);
  if (!result.valid) {
    const said = result.issues.map((issue) => `${issue.path || "/"} ${issue.keyword}: ${issue.message}`).join("; ");
    return refusal("InvalidManifest", `manifest does not conform to provenance-manifest.schema.json: ${said}`);
  }
  for (const entity of manifest.entities) {
    if (!isNiUri(entity.ni)) return refusal("InvalidManifest", `entity ${entity.id} ni is not a canonical RFC 6920 sha-256 ni: URI`);
  }
  return Object.freeze({
    ok: true,
    manifest: {
      baseIri: /[/#:]$/u.test(manifest.baseIri ?? DEFAULT_BASE_IRI) ? (manifest.baseIri ?? DEFAULT_BASE_IRI) : `${manifest.baseIri}/`,
      agents: manifest.agents.map((agent) => ({ ...agent })),
      activities: manifest.activities.map((activity) => ({
        ...activity,
        used: activity.used ?? [],
        generated: activity.generated ?? [],
        wasAssociatedWith: activity.wasAssociatedWith ?? [],
      })),
      entities: manifest.entities.map((entity) => ({
        ...entity,
        wasDerivedFrom: entity.wasDerivedFrom ?? [],
        wasAttributedTo: entity.wasAttributedTo ?? [],
      })),
    },
  });
}

/** Lookup tables over an admitted manifest. An entity is named by its id or by its ni. */
export function indexManifest(manifest) {
  const agents = new Map(), activities = new Map(), entitiesById = new Map(), entitiesByNi = new Map();
  for (const agent of manifest.agents) if (!agents.has(agent.id)) agents.set(agent.id, agent);
  for (const activity of manifest.activities) if (!activities.has(activity.id)) activities.set(activity.id, activity);
  for (const entity of manifest.entities) {
    if (!entitiesById.has(entity.id)) entitiesById.set(entity.id, entity);
    if (!entitiesByNi.has(entity.ni)) entitiesByNi.set(entity.ni, entity);
  }
  return {
    agents, activities, entitiesById, entitiesByNi,
    entity: (reference) => entitiesById.get(reference) ?? entitiesByNi.get(reference),
  };
}

/** Code-point order, independent of locale. */
export function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
