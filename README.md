# @red-cup-engineering/prov-o-provenance-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Turns the provenance a build already holds — `ni:` content addresses, git source
records, who did what and when — into W3C PROV-O (`http://www.w3.org/ns/prov#`),
as canonical Turtle and JSON-LD. Three operations over one input, the **build
provenance manifest** (`data/records/schema/provenance-manifest.schema.json`):

```jsonc
{
  "baseIri": "https://example.org/prov/",          // optional; default urn:provenance:
  "agents":     [{ "id", "name", "kind": "person|software|organization|ai-system", "actedOnBehalfOf"? }],
  "activities": [{ "id", "label", "startedAt", "endedAt", "plan"?, "used": [], "generated": [],
                   "wasAssociatedWith": [{ "agent", "role" }] }],
  "entities":   [{ "id", "path", "ni", "bytes", "mediaType",
                   "git"?: { "repository", "revision", "path", "blob" },
                   "wasDerivedFrom": [], "wasAttributedTo": [], "license"? }]
}
```

An id with a URI scheme is its own IRI; any other id is minted under `baseIri`
(`<baseIri>agent/<id>`, `<baseIri>activity/<id>`, `<baseIri>role/<role>`). An
**entity is always identified by its `ni:` address**, and a reference to an entity
may name its `id` or its `ni`.

The RDF terms, N-Quads lines and RDFC-1.0 canonicalization are the house's own
(`@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section`
`rdf-terms`, `n-quads`, `rdf-canonicalization`); this package adds the PROV-O mapping
and nothing that serializes Turtle.

## Operations

All three answer `{ok: true, ...}` or `{ok: false, refusal: {reason, message}}`.
Each command reads one JSON value per input line and writes one JSON value per output line.

### projectProvenanceAsProvO

~~~js
export async function projectProvenanceAsProvO(manifest)
~~~

- Returns `{ok: true, turtle, jsonLd, canonicalNi, tripleCount, closure: {warnings, roots}}`.
- Refusals: `InvalidManifest` (schema, malformed `ni`); `ProvenanceNotClosed` (any
  error-level gap from `checkProvenanceClosure`; `refusal.gaps` lists them).
- Precondition: the manifest conforms to the schema and its references resolve.
- Postcondition: `turtle` is the RDFC-1.0 canonical form of the PROV-O graph, written as
  N-Triples (a subset of Turtle 1.1), so two manifests that mean the same graph give the same bytes;
  `jsonLd` is the same graph with sorted nodes and values under a four-prefix context
  (`prov`, `dcterms`, `rdfs`, `xsd`); `canonicalNi` is the `ni:` address of the Turtle bytes.
- Preserved frame: the input manifest (never mutated) and every entity's `ni`.
- Effect class: pure (no clock, no filesystem, no network).
- Witness: `canonicalNi`; re-projecting the same manifest yields the same value.
- Command: `project-provenance-as-prov-o` reads one manifest per line.

Mapping:

| manifest | PROV-O |
|---|---|
| entity | `prov:Entity` at its `ni:` IRI; `rdfs:label` path; `dcterms:format`; `dcterms:extent`; `dcterms:license` (SPDX id becomes `https://spdx.org/licenses/<id>`) |
| `entity.git` | `dcterms:identifier "git:blob:<blob>"`; `dcterms:source` `<https://github.com/<repository>/blob/<revision>/<path>>` when the repository is `owner/name` or an https URL |
| `wasDerivedFrom` / `wasAttributedTo` | `prov:wasDerivedFrom` / `prov:wasAttributedTo` |
| activity | `prov:Activity`; `prov:startedAtTime`, `prov:endedAtTime` (`xsd:dateTime`); `prov:used`; `prov:wasGeneratedBy` on each generated entity |
| association | `prov:wasAssociatedWith` and a qualified `prov:Association` (`prov:agent`, `prov:hadRole` to a `prov:Role`, `prov:hadPlan` to the activity's `plan`, which is typed `prov:Plan`) |
| agent `person` / `organization` | `prov:Person` / `prov:Organization` (and `prov:Agent`) |
| agent `software` / `ai-system` | `prov:SoftwareAgent` (and `prov:Agent`), `dcterms:type "software"` or `"ai-system"` |
| `actedOnBehalfOf` | `prov:actedOnBehalfOf`, plus a `prov:Delegation` scoped to each activity the agent is associated with (`prov:hadActivity`) |

An AI coauthor is `{kind: "ai-system", actedOnBehalfOf: "<the accountable human>"}`
associated with role `research-collaborator`. Association and delegation IRIs are
`ni:`-derived hashes of their parts, so they are stable.

Not mapped: qualified usage and generation, `prov:wasInformedBy`, bundles.

### computeFileProvenanceEntities

~~~js
export function computeFileProvenanceEntities({ files: [{ path, bytesBase64, mediaType?, id?, git?, license?, wasDerivedFrom?, wasAttributedTo? }] })
~~~

- Returns `{ok: true, entities}`: manifest entities `{id, path, ni, bytes, mediaType, ...}` sorted by path (`id` defaults to the path; media type to the extension's, else `application/octet-stream`).
- Refusals: `InvalidRequest`, `InvalidPath` (absolute, `\`, empty/`.`/`..` segments), `DuplicatePath`, `DuplicateId`, `InvalidBase64`.
- Precondition: each path is a relative `/`-separated name; bytes are canonical base64.
- Postcondition: `ni` is the RFC 6920 sha-256 name of exactly the decoded bytes (via `addressContent`), `bytes` their length.
- Preserved frame: the input bytes and every pass-through field.
- Effect class: pure.
- Witness: `ni` is recomputable from the bytes with any RFC 6920 implementation.
- Command: `compute-file-provenance-entities` reads one `{files: [...]}` per line.

### checkProvenanceClosure

~~~js
export function checkProvenanceClosure(manifest)
~~~

- Returns `{ok: true, closed, gaps, summary: {agents, activities, entities, roots, errors, warnings}}`. `closed` holds when no gap has severity `error`. `roots` are entities no activity generated (the inputs).
- Refusals: `InvalidManifest`.
- Error gaps: `derived-entity-without-generating-activity`, `used-entity-undeclared`, `generated-entity-undeclared`, `derivation-unresolved`, `attribution-agent-undeclared`, `association-agent-undeclared`, `delegation-agent-undeclared`, `plan-undeclared`, `duplicate-id`, `derivation-cycle`, `delegation-cycle`, `activity-ends-before-start`, `activity-time-invalid`.
- Warning gaps: `derivation-not-used-by-generator`, `entity-generated-by-multiple-activities`, `entity-address-shared`, `plan-without-association`, `ai-system-without-accountable-agent`.
- Precondition: the manifest conforms to the schema.
- Postcondition: every gap is listed, sorted by `(kind, subject, reference)`; the same manifest gives the same list.
- Preserved frame: the manifest.
- Effect class: pure.
- Witness: each gap names the subject and reference that break closure.
- Command: `check-provenance-closure` reads one manifest per line.

## Invocation

```sh
node scripts/compute-file-provenance-entities.mjs <<< '{"files":[{"path":"a.md","bytesBase64":"IyBBCg=="}]}'
node scripts/check-provenance-closure.mjs < manifest.ndjson
node scripts/project-provenance-as-prov-o.mjs < manifest.ndjson
```

The manifest must be one line of JSON per request (`jq -c . manifest.json`).

## Offers

One held offer per operation is in `data/records/offers/` (`saleStatus: "held"`; nothing is sold until a
receiver enables it), each validated by `declareOffer` from `@red-cup-engineering/x402-services-section`.

## Tests

`npm test` — golden Turtle, determinism, closure failures, and a JSON-LD conformance check that expands the
emitted JSON-LD with a real JSON-LD processor and compares it, under RDFC-1.0, with the Turtle.
