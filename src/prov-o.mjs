import { iriTerm, literal } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/rdf-terms";
import { nquadLine } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/n-quads";
import { canonicalizeNQuads } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/rdf-canonicalization";
import { addressContent } from "@red-cup-engineering/computer-content-address-engineering-services-section/content-address";
import { admitManifest, compare, indexManifest, mintIri, refusal } from "./manifest.mjs";
import { provenanceGaps } from "./closure.mjs";

export const PROV = "http://www.w3.org/ns/prov#";
export const DCTERMS = "http://purl.org/dc/terms/";
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
const RDF_TYPE = `${RDF}type`;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const SPDX_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/u;

const AGENT_TYPES = {
  person: ["Person"],
  organization: ["Organization"],
  software: ["SoftwareAgent"],
  "ai-system": ["SoftwareAgent"],
};

const hash = (text) => addressContent(new TextEncoder().encode(text)).ni.slice("ni:///sha-256;".length);

function repositoryUrl(repository) {
  if (/^https:\/\//u.test(repository)) return repository.replace(/\.git$/u, "").replace(/\/$/u, "");
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) return `https://github.com/${repository}`;
  return undefined;
}

function licenseTerm(license) {
  if (SCHEME.test(license)) return iriTerm(license);
  if (SPDX_ID.test(license)) return iriTerm(`https://spdx.org/licenses/${license}`);
  return literal(license);
}

/** Project an admitted manifest into PROV-O statements. Order is not significant. */
export function provStatements(manifest) {
  const base = manifest.baseIri, index = indexManifest(manifest);
  const statements = [];
  const add = (subject, predicate, object) => statements.push({ subject, predicate, object });
  const type = (subject, name) => add(subject, RDF_TYPE, iriTerm(`${PROV}${name}`));
  const agentIri = (id) => mintIri(base, "agent", id);
  const entityIri = (reference) => index.entity(reference).ni;
  const dateTime = (value) => literal(value, { datatype: `${XSD}dateTime` });

  for (const agent of manifest.agents) {
    const subject = agentIri(agent.id);
    type(subject, "Agent");
    for (const name of AGENT_TYPES[agent.kind]) type(subject, name);
    if (agent.kind === "software" || agent.kind === "ai-system") add(subject, `${DCTERMS}type`, literal(agent.kind));
    add(subject, `${RDFS}label`, literal(agent.name));
    if (agent.actedOnBehalfOf !== undefined) add(subject, `${PROV}actedOnBehalfOf`, iriTerm(agentIri(agent.actedOnBehalfOf)));
  }

  for (const activity of manifest.activities) {
    const subject = mintIri(base, "activity", activity.id);
    type(subject, "Activity");
    add(subject, `${RDFS}label`, literal(activity.label));
    add(subject, `${PROV}startedAtTime`, dateTime(activity.startedAt));
    add(subject, `${PROV}endedAtTime`, dateTime(activity.endedAt));
    for (const reference of activity.used) add(subject, `${PROV}used`, iriTerm(entityIri(reference)));
    for (const reference of activity.generated) add(entityIri(reference), `${PROV}wasGeneratedBy`, iriTerm(subject));
    const plan = activity.plan === undefined ? undefined : entityIri(activity.plan);
    for (const { agent: agentId, role } of activity.wasAssociatedWith) {
      const agent = agentIri(agentId), roleIri = mintIri(base, "role", role);
      const association = `${base}association/${hash(`${subject}\u0000${agent}\u0000${role}`)}`;
      add(subject, `${PROV}wasAssociatedWith`, iriTerm(agent));
      add(subject, `${PROV}qualifiedAssociation`, iriTerm(association));
      type(association, "Association");
      add(association, `${PROV}agent`, iriTerm(agent));
      add(association, `${PROV}hadRole`, iriTerm(roleIri));
      if (plan !== undefined) add(association, `${PROV}hadPlan`, iriTerm(plan));
      type(roleIri, "Role");
      add(roleIri, `${RDFS}label`, literal(role));
      const principal = index.agents.get(agentId)?.actedOnBehalfOf;
      if (principal !== undefined) {
        const delegation = `${base}delegation/${hash(`${subject}\u0000${agent}\u0000${principal}`)}`;
        add(agent, `${PROV}qualifiedDelegation`, iriTerm(delegation));
        type(delegation, "Delegation");
        add(delegation, `${PROV}agent`, iriTerm(agentIri(principal)));
        add(delegation, `${PROV}hadActivity`, iriTerm(subject));
      }
    }
    if (plan !== undefined) type(plan, "Plan");
  }

  for (const entity of manifest.entities) {
    const subject = entity.ni;
    type(subject, "Entity");
    add(subject, `${RDFS}label`, literal(entity.path));
    add(subject, `${DCTERMS}format`, literal(entity.mediaType));
    add(subject, `${DCTERMS}extent`, literal(String(entity.bytes), { datatype: `${XSD}nonNegativeInteger` }));
    if (entity.license !== undefined) add(subject, `${DCTERMS}license`, licenseTerm(entity.license));
    if (entity.git !== undefined) {
      add(subject, `${DCTERMS}identifier`, literal(`git:blob:${entity.git.blob}`));
      const url = repositoryUrl(entity.git.repository);
      if (url !== undefined) {
        const path = entity.git.path.split("/").map(encodeURIComponent).join("/");
        add(subject, `${DCTERMS}source`, iriTerm(`${url}/blob/${entity.git.revision}/${path}`));
      }
    }
    for (const reference of entity.wasDerivedFrom) add(subject, `${PROV}wasDerivedFrom`, iriTerm(entityIri(reference)));
    for (const reference of entity.wasAttributedTo) add(subject, `${PROV}wasAttributedTo`, iriTerm(agentIri(reference)));
  }
  return statements;
}

const PREFIXES = [["dcterms", DCTERMS], ["prov", PROV], ["rdfs", RDFS], ["xsd", XSD]];
function compact(iri) {
  for (const [prefix, namespace] of PREFIXES) if (iri.startsWith(namespace) && iri.length > namespace.length) return `${prefix}:${iri.slice(namespace.length)}`;
  return iri;
}

/** JSON-LD (compacted with the four-prefix context) for the same statements; nodes and values sorted. */
export function provJsonLd(statements) {
  const nodes = new Map();
  for (const { subject, predicate, object } of statements) {
    if (!nodes.has(subject)) nodes.set(subject, new Map());
    const properties = nodes.get(subject);
    const key = predicate === RDF_TYPE ? "@type" : compact(predicate);
    const value = predicate === RDF_TYPE ? compact(object.value)
      : object.kind === "iri" ? { "@id": object.value }
        : object.datatype === undefined && object.language === undefined ? object.value
          : { "@value": object.value, ...(object.datatype === undefined ? { "@language": object.language } : { "@type": compact(object.datatype) }) };
    if (!properties.has(key)) properties.set(key, new Map());
    properties.get(key).set(JSON.stringify(value), value);
  }
  const graph = [...nodes.keys()].sort(compare).map((id) => {
    const node = { "@id": id };
    for (const key of [...nodes.get(id).keys()].sort(compare)) {
      const values = [...nodes.get(id).get(key).entries()].sort(([a], [b]) => compare(a, b)).map(([, value]) => value);
      node[key] = values.length === 1 ? values[0] : values;
    }
    return node;
  });
  return { "@context": Object.fromEntries(PREFIXES), "@graph": graph };
}

/**
 * Project a build provenance manifest as W3C PROV-O. The Turtle is the RDFC-1.0 canonical
 * N-Triples form of the graph (a subset of Turtle 1.1), so equal manifests give equal bytes;
 * the JSON-LD is the same graph with sorted nodes and values.
 * @param {object} manifest A build provenance manifest.
 * @returns {Promise<object>} `{ok: true, turtle, jsonLd, canonicalNi, tripleCount, closure}` or a refusal.
 */
export async function projectProvenanceAsProvO(manifest) {
  const admitted = admitManifest(manifest);
  if (!admitted.ok) return admitted;
  const closure = provenanceGaps(admitted.manifest);
  if (!closure.closed) {
    const errors = closure.gaps.filter((gap) => gap.severity === "error");
    return refusal("ProvenanceNotClosed", `${errors.length} provenance gap(s) leave references dangling: ${errors.slice(0, 3).map((gap) => `${gap.kind} ${gap.subject.id}`).join("; ")}`, { gaps: errors });
  }
  const statements = provStatements(admitted.manifest);
  const turtle = await canonicalizeNQuads(`${statements.map(nquadLine).join("\n")}\n`);
  const canonical = turtle.split("\n").filter((line) => line !== "");
  return Object.freeze({
    ok: true,
    turtle,
    jsonLd: provJsonLd(statements),
    canonicalNi: addressContent(new TextEncoder().encode(turtle), { mediaType: "application/n-triples" }).ni,
    tripleCount: canonical.length,
    closure: { warnings: closure.gaps.filter((gap) => gap.severity === "warning"), roots: closure.summary.roots },
  });
}
