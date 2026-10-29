# @red-cup-engineering/prov-o-provenance-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Turns the provenance a build already holds — `ni:` content addresses, git source
records, who did what and when — into W3C PROV-O (`http://www.w3.org/ns/prov#`),
as canonical Turtle and JSON-LD. The original operations use one input, the **build
provenance manifest** (`data/records/schema/provenance-manifest.schema.json`):

```jsonc
{
  "baseIri": "https://example.org/prov/",          // optional; default urn:provenance:
  "agents":     [{ "id", "name", "kind": "person|software|organization|ai-system", "actedOnBehalfOf"? }],
  "activities": [{ "id", "label", "startedAt", "endedAt", "plan"?, "used": [], "generated": [],
                   "wasAssociatedWith": [{ "agent", "role" }] }],
  "entities":   [{ "id", "path", "ni", "bytes", "mediaType",
                   "git"?: { "repository", "revision", "path", "blob" },
                   "wasDerivedFrom": [], "wasAttributedTo": [], "license"?, "rights"?, "usageInfo"?, "creditText"? }]
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
| `rights`, `usageInfo`, `creditText` | `dcterms:rights` (literal), `schema:usageInfo` (URL), `schema:creditText` (literal), independently of `dcterms:license`; `schema` prefix only appears where used |
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
export function computeFileProvenanceEntities({ files: [{ path, bytesBase64, mediaType?, id?, git?, license?, rights?, usageInfo?, creditText?, wasDerivedFrom?, wasAttributedTo? }] })
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
- Error gaps: `derived-entity-without-generating-activity`, `used-entity-undeclared`, `generated-entity-undeclared`, `derivation-unresolved`, `attribution-agent-undeclared`, `association-agent-undeclared`, `delegation-agent-undeclared`, `plan-undeclared`, `duplicate-id`, `derivation-cycle`, `delegation-cycle`, `activity-ends-before-start`, `activity-time-invalid`, `ambiguous-content-address-reference`, `shared-content-rights-conflict`.
- Warning gaps: `derivation-not-used-by-generator`, `entity-generated-by-multiple-activities`, `entity-address-shared`, `plan-without-association`, `ai-system-without-accountable-agent`.
- Precondition: the manifest conforms to the schema.
- Postcondition: every gap is listed, sorted by `(kind, subject, reference)`; the same manifest gives the same list.
- Preserved frame: the manifest.
- Effect class: pure.
- Witness: each gap names the subject and reference that break closure.
- Command: `check-provenance-closure` reads one manifest per line.

## assessProvenanceRevisionImpact

The fourth original-PROV operation compares **two editions of the same source-closed manifest**. It reuses exactly the existing `provenance-manifest.schema.json` admission, PROV-O entity/Activity identities, and `checkProvenanceClosure` semantics rather than constructing a new knowledge graph.

```sh
# JSON input: {"previous": <manifest edition 1>, "current": <manifest edition 2>}
# Emits one exact JSON result/refusal per line.
node scripts/assess-provenance-revision-impact.mjs < two-editions.ndjson
# The pure, dependency-free graph-screening controls:
node --test test/revision-impact.test.mjs
# With original published dependencies available, the native admission tests:
node --test test/revision-impact-admission.test.mjs
```

- **Preconditions:** both input editions are independently valid and closed under this package's existing checker, use the same `baseIri` and preserve stable logical entity IDs across editions. A changed `ni:` means changed source *bytes*, not that a scientific conclusion has been falsified. If a logical ID is changed, the operation reports one removed and one added entity rather than silently assuming sameness.
- **Exact detection:** added/removed entities, changed `ni:` byte addresses, separately changed `license`, `rights`, `usageInfo`, `creditText`, attribution/Git metadata, changed dependency edges, changed generating activities, and revisions to the accountable agent or any of its delegating principals in either admitted edition. Both editions' direct `prov:wasDerivedFrom` dependencies and `prov:used`/generation (including an activity's plan) generate the **union dependency graph**. It screens transitive reachable descendants; an unchanged downstream `ni:` is reported as a *possible stale artifact requiring independent review*.
- **Result:** deterministic `directChanges`, `changedActivities`, `changedAgents` (directly revised agents), `responsibilityAffectedAgents` (including their transitive `actedOnBehalfOf` delegates), `affected` with one explicit shortest witness path and edge kinds, `potentiallyStaleUnchanged`, counts, a typed refusal on incompatible/incomplete inputs, and an epistemic-status boundary. This is a conservative impact *candidate*, not content invalidation, an event subscription, a fresh Web acquisition, a human author decision or a publication effect. All activity outputs may be conservatively affected by any of that activity's inputs; the actual dependency can be narrower.
- **Bounds:** at most 10,000 entities, 5,000 activities, 10,000 agents per edition and 200,000 distinct source→target edges in the union graph. This keeps the source-level tool bounded without imposing these artificial limits on the underlying scientific truth or richer external research designs.

Delegation changes trigger a conservative **review obligation**, not a finding that an unchanged researcher or software agent changed their behavior or that a principal granted authority. The comparator follows already admitted `actedOnBehalfOf` links across both old and new versions; it does not manufacture a source revision, infer identity from text, or authenticate the agent relationship. The pure regression suite covers a two-hop institutional delegation, indirect attribution, same-edition idempotence, and an unrelated-agent negative control.

### Original SignChain evidence → PROV research re-evaluation

The same existing `assessProvenanceRevisionImpact` operation now also accepts **optional, paired** `signchainComparison` and `propositionEntities` inputs. It does not import SignChain, infer that a timestamp is a revision, or add a second provenance graph. The producer of the comparison remains the original SignChain [sealed-history source module](https://github.com/red-cup-engineering/signchain/blob/research/original-evidence-snapshot-recheck-20261028/src/source-withdrawal.mjs), currently under [PR #36](https://github.com/red-cup-engineering/signchain/pull/36); independently qualify that producer and its version before using this in production.

The comparison must be an actual result shape from `compareOriginalEvidenceSnapshots`: `type: "signchain.originalEvidenceSnapshotComparison.v1"`, `monitoredPropositionCount`, `comparisons` (each with `propositionAddress`, `witnessesChanged`, `observationsChanged`, `requiresReverification`), and `changedPropositionAddresses`. Its flags and summary must agree, with at most 128 distinct original propositions. An explicit `propositionEntities` array maps **each** changed SignCell proposition address to exactly one stable **logical entity id** in both closed PROV manifest editions; several propositions may map to one source entity. An unknown, duplicate, extra, missing or edition-unstable binding refuses. The operation never guesses entity identity from URL, DOI, document title, byte equality or witness address.

For example, the *structural* caller input below, using synthetic addresses and identical manifest editions, requests review of a source entity `source-a` and all its PROV descendants without changing their recorded bytes:

```json
{
  "previous": {"agents":[],"activities":[],"entities":[{"id":"source-a","path":"source.txt","ni":"ni:///sha-256;47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU","bytes":0,"mediaType":"text/plain"}]},
  "current":  {"agents":[],"activities":[],"entities":[{"id":"source-a","path":"source.txt","ni":"ni:///sha-256;47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU","bytes":0,"mediaType":"text/plain"}]},
  "signchainComparison": {
    "type": "signchain.originalEvidenceSnapshotComparison.v1",
    "monitoredPropositionCount": 1,
    "changedPropositionAddresses": ["synthetic-signcell-proposition-1"],
    "comparisons": [{"propositionAddress":"synthetic-signcell-proposition-1","witnessesChanged":false,"observationsChanged":true,"requiresReverification":true}]
  },
  "propositionEntities": [{"propositionAddress":"synthetic-signcell-proposition-1","entityId":"source-a"}]
}
```

The result retains regular `directChanges`, adding the specific reason `signchain-original-evidence-recheck` for a caller-qualified mapping. Its `reverificationBindings` preserves original proposition addresses; `affected` and `potentiallyStaleUnchanged` are computed by the **existing** PROV dependency traversal. A changed clock or original witness is a **re-verification candidate**, even when FOUR readings, manifest NIs, or paper bytes are unchanged. It is **not** proof that an external document was revised, that a publisher changed a notice, that a clock was authentic, or that a claim is false. The binding is source-supplied testimony, not independently established correspondence; downstream Science must authenticate, assay, revise and receive the claim in its original Work. No Work, SignChain event, license, publication status or scientific proof is automatically changed.

The original native admission suite includes stable-source negative controls, witness-versus-clock effects, exact source mapping refusals, multiple coordinates per entity, and coexistence with a genuine byte revision. Run `node --test test/revision-impact-admission.test.mjs` and the full `npm test`. PROV can independently receive closed manifest editions without installing internal 561 Group systems; consumers need their own source-authenticated SignChain histories for genuine field replication.

**Two real disciplinary input shapes:** The [Astronomy Science 2026 lunar-reference object](https://github.com/lenticule-science/astronomy-science-services-section/pull/13) has an external computed-almanac CSV, model calculations and a research note. A future *genuine* change to that pinned CSV must re-open its dependent calculation and conclusions; the test's artificial changed source is only an injected control, **not evidence that the USNO table changed**. In [Sociology Science's documentary evidence register](https://github.com/lenticule-science/sociology-science-services-section/blob/main/data/records/radical-political-learning-evidence-2026-10-15.json), one source document S22 underlies episodes E02 and E03: a revision to the same documentary source may affect both source-derived records. Two episodes do **not** thereby constitute two independent corroborating documents. These two domain examples are checked in `test/revision-impact.test.mjs`; the real scientific sources stay in their disciplinary owners.

**Prior art:** W3C [PROV-O](https://www.w3.org/TR/prov-o/) already specifies derivation, usage, generation, plan and responsibility. This operation contributes only the **deterministic, bounded revision-impact screening rule** over our existing manifests. It does not claim to invent provenance graph reachability, epistemic uncertainty or a new formal closure theory. Research objects can continue to be packaged under [RO-Crate](https://www.researchobject.org/ro-crate/specification) while source manifests remain the underlying computational witness. Future consumers should route changed source IDs to their original Science/SignChain claim-owner, not introduce a second annotation registry or claim that a passing structural screen certifies science.

**Economic boundary:** This is an independently callable original Engineering operation and a candidate supplier for research commissions through the *existing* Curiosity Research Market and `market.561.group`. Neither adding an executable nor changing a package version admits a price, customer, verified settlement, installed host or lawful redistribution of upstream sources.

## Source-use testimony and scientific rights

The existing `license` field is an **assertion**, not a legal audit.
A bare identifier is projected as `https://spdx.org/licenses/<id>` **only
when it appears in the original, pinned [SPDX License List 3.29.0](https://github.com/spdx/license-list-data/blob/v3.29.0/json/licenses.json)**
(source Git blob `79ca1b1f6792d599d4fc680782e1f81f5923b636`,
740 identifiers). The minimal, attributed identifier-only reference is
kept in `data/records/spdx-license-identifiers-v3.29.0.json` and checked
in the original native PROV-O suite. This is a versioned standards
vocabulary, **not** a second license registry or source of permissions.

An arbitrary syntax-compatible token (`all-rights-reserved`,
`Permission-Pending`, `Unlicensed`, or a private `LicenseRef-...`)
is **not** a recognized SPDX license solely because it contains letters,
digits or hyphens. These and composite license expressions remain
literal source assertions; do not fabricate an SPDX document URI for
them. An explicitly supplied absolute license IRI remains an IRI, but
its existence and authority are not checked by projecting it.
A composite SPDX expression must not be misrepresented as a single
SPDX license identifier. This preserves original RFC-valid RDF/JSON-LD,
the 94-triple fixture golden for recognized licenses, source provenance,
and the distinction between recording a claim and obtaining permission.

An entity's `license` remains the existing explicit grant field. The distinct
optional `rights` (source-qualified text), `usageInfo` (actual HTTP(S) usage
notice URL) and `creditText` (attribution text) have separate meanings.
The original manifest schema admits these source fields; the existing file
entity operation retains them; the original PROV-O projection emits
`dcterms:rights`, `schema:usageInfo` and `schema:creditText`, without
manufacturing a `dcterms:license`. Unchanged manifests keep the previously
reviewed four-prefix JSON-LD context; `schema` is emitted only for manifests
actually using that namespace. For the exact bytes/identity, retain the
existing `ni:` content hash independently.

This is motivated by [Lenticule Astronomy's 2026 USNO reference custody](https://github.com/lenticule-science/astronomy-science-services-section/pull/16).
The official [USNO website notice](https://aa.usno.navy.mil/about/PrivacyNotice)
permits distributing/copying site information unless otherwise specified
and requests appropriate credits. It does not by itself license the Group's
transcription, prove rights for undisclosed third-party material, or attest
a timestamp. Astronomy's PROV-O source node is an external USNO page **whose
HTML bytes were not archived**; the Group's hashed CSV is a distinct derived
entity. Do not invent a `ni:` for the unarchived external page or conflate
its source-use notice with a license for the CSV.

A **hypothetical** later change to a rights statement, usage notice link or
credit, even with the same `ni:` bytes, makes an entity a direct reassessment
candidate in the existing `assessProvenanceRevisionImpact` graph. Its
`prov:wasDerivedFrom` and activity edges conservatively propagate the
candidate to derived research objects. This neither certifies that an external
notice really changed nor authenticates its provenance: independent source
acquisition, chronology, community rights, competent scientific receiving
and publication authority are separate gates. The original `compose`
operation refuses conflicting rights scalars for one entity ID instead of
silently overwriting the earlier declaration.

## Source occurrence vs. content identity: ambiguity is a refusal

The existing `ni:///sha-256;` identity names **content bytes**, not a
unique observation, publication, Git source path, consent decision or
rights-bearing source *occurrence*. For example, the original Lenticule
Astronomy USNO reference CSV and the byte-identical Red Cup reproduction
fixture are two original logical source files; their equal bytes cannot
by themselves establish independent source testimony. A research output
depending on one must retain that particular original manifest entity
`id`, its provenance and required source-use rights.

This original manifest already permits distinct entity ids with the same
NI and reports `entity-address-shared` as a warning: **that is preserved**.
But a dependency specified only by a shared NI is *under-specified*.
The native closure and projection now refuse it as
`ambiguous-content-address-reference` in `used`, `generated`,
`plan` and `wasDerivedFrom`. Use the **actual logical entity id**
instead of letting one reader select the first matching source and a
different revision-impact reader select the last. This is particularly
important when a source's rights change while the copied bytes do not.
The original impact wrapper refuses an ambiguous edition before reporting
`no-affected-entities-detected`, so input order cannot suppress a
re-evaluation.

Because the original PROV-O projector uses the NI itself as an RDF
`prov:Entity` subject, two logically distinct declarations with the
same NI cannot safely emit **different** `license`, `rights`,
`usageInfo` or `creditText` assertions onto that one subject. Such
editions refuse with `shared-content-rights-conflict`; an omitted
grant is not equivalent to a granted license. Same-byte declarations
with **compatible** rights metadata and exclusively **explicit logical
id** dependency references remain admitted, with the original
`entity-address-shared` warning. This does not establish that two
copies are independent corroborating evidence or identify rights at an
unarchived upstream URL. Fully distinct source-occurrence attribution
requires its competent source owner and a qualified provenance
representation, not a fabricated extra content hash.

This fixes a demonstrated *order-dependent false-negative* in the
existing revision-impact screen: two original logical source ids
sharing one NI could change an attribution/rights assertion, while a
derived paper referring to that NI was either flagged or missed
depending solely on declaration order. The existing closure/impact
and PROV-O operations now fail closed before making either claim.
No second provenance graph, Source/Claim registry, inference of
truth, retraction, license grant, or publication authority is created.

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

## composeProvenanceManifest

~~~js
export function composeProvenanceManifest({ fragments, baseIri? })
~~~

Composes manifest fragments into one admitted manifest. Typical fragments are a
renderer's build receipt (`receipt.provenance` from
`project-document-through-pandoc-service`), the people and organizations a paper
declares as data, and an analysis run.

- Declarations that share an `id` merge. List fields (`used`, `generated`,
  `wasAssociatedWith`, `wasDerivedFrom`, `wasAttributedTo`) are unioned.
- The output is ordered by `id`, so the same fragments in any order compose
  to the same bytes.
- Refusals: `InvalidRequest`, `ConflictingBaseIri`, `ConflictingDeclaration`
  (the same id declares a scalar twice with different values), and
  `InvalidManifest` (the composed manifest fails the schema).
- **Precondition:** every fragment is a JSON object.
- **Postcondition:** the output is a manifest that `admitManifest` accepts.
- **Frame:** input fragments are not mutated.
- **Effect class:** pure.

Command: `compose-provenance-manifest` reads one JSON value per input line and
writes one JSON value per output line.
