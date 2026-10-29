import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import jsonld from "jsonld";
import { canonicalizeNQuads } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/rdf-canonicalization";
import { checkProvenanceClosure, computeFileProvenanceEntities, projectProvenanceAsProvO } from "../index.mjs";
import { buildManifest } from "./fixture.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const GOLDEN = here("golden/build.ttl");
const clone = (value) => structuredClone(value);
const entityNamed = (manifest, id) => manifest.entities.find((entity) => entity.id === id);

test("golden: the fixture build projects to exactly the reviewed Turtle", async () => {
  const result = await projectProvenanceAsProvO(buildManifest());
  assert.equal(result.ok, true);
  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) writeFileSync(GOLDEN, result.turtle);
  assert.equal(result.turtle, readFileSync(GOLDEN, "utf8"));
  assert.equal(result.tripleCount, 94);
  const sha = createHash("sha256").update(result.turtle).digest("base64url");
  assert.equal(result.canonicalNi, `ni:///sha-256;${sha}`);
});

test("PROV-O terms: classes, qualified association with role, plan, delegation, license, git blob", async () => {
  const { turtle } = await projectProvenanceAsProvO(buildManifest());
  const PROV = "http://www.w3.org/ns/prov#";
  const has = (line) => assert.ok(turtle.includes(line), `missing: ${line}`);
  has(`<https://example.org/prov/agent/claude> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${PROV}SoftwareAgent> .`);
  has(`<https://example.org/prov/agent/claude> <${PROV}actedOnBehalfOf> <https://example.org/prov/agent/emsenn> .`);
  has(`<https://example.org/prov/role/research-collaborator> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${PROV}Role> .`);
  assert.match(turtle, new RegExp(`<https://example.org/prov/association/[A-Za-z0-9_-]{43}> <${PROV}hadRole> <https://example.org/prov/role/research-collaborator> \\.`, "u"));
  assert.match(turtle, new RegExp(`<${PROV}hadPlan> <ni:///sha-256;[A-Za-z0-9_-]{43}> \\.`, "u"));
  assert.match(turtle, new RegExp(`<ni:///sha-256;[A-Za-z0-9_-]{43}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${PROV}Plan> \\.`, "u"));
  has(`<http://purl.org/dc/terms/license> <https://spdx.org/licenses/CC-BY-4.0> .`);
  has(`<http://purl.org/dc/terms/identifier> "git:blob:89abcdef0123456789abcdef0123456789abcdef" .`);
  has(`"2026-10-24T12:00:02Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>`);
  has(`<${PROV}hadActivity> <https://example.org/prov/activity/draft-intro> .`);
});

test("source use, rights and credit project as separate RDF/JSON-LD testimony, never as a license", async () => {
  const manifest = buildManifest();
  const source = entityNamed(manifest, "references.yaml");
  delete source.license;
  source.usageInfo = "https://aa.usno.navy.mil/about/PrivacyNotice";
  source.rights = "Public source-use notice; exceptions may apply";
  source.creditText = "U.S. Naval Observatory, Astronomical Applications Department";
  const result = await projectProvenanceAsProvO(manifest);
  assert.equal(result.ok, true, JSON.stringify(result.refusal));
  const entity = `<${source.ni}>`;
  assert.ok(result.turtle.includes(`${entity} <http://purl.org/dc/terms/rights> "Public source-use notice; exceptions may apply" .`));
  assert.ok(result.turtle.includes(`${entity} <https://schema.org/usageInfo> <https://aa.usno.navy.mil/about/PrivacyNotice> .`));
  assert.ok(result.turtle.includes(`${entity} <https://schema.org/creditText> "U.S. Naval Observatory, Astronomical Applications Department" .`));
  assert.equal(result.turtle.includes(`${entity} <http://purl.org/dc/terms/license>`), false);
  assert.equal(result.jsonLd["@context"].schema, "https://schema.org/");
  const nquads = await jsonld.toRDF(result.jsonLd, { format: "application/n-quads" });
  assert.equal(await canonicalizeNQuads(nquads), result.turtle);
});

test("source-use values must be admitted as rights text and an actual URL, not an executable pseudo-URL", async () => {
  for (const [field, value] of [
    ["rights", ""], ["creditText", ""], ["usageInfo", "javascript:alert(1)"],
    ["usageInfo", "https://example.org/rights notice"]
  ]) {
    const manifest = buildManifest();
    entityNamed(manifest, "references.yaml")[field] = value;
    const result = await projectProvenanceAsProvO(manifest);
    assert.equal(result.ok, false, field);
    assert.equal(result.refusal.reason, "InvalidManifest");
  }
});

test("determinism: same bytes on re-projection and when the manifest's arrays are reordered", async () => {
  const manifest = buildManifest();
  const first = await projectProvenanceAsProvO(manifest);
  const again = await projectProvenanceAsProvO(clone(manifest));
  assert.equal(first.turtle, again.turtle);
  assert.equal(JSON.stringify(first.jsonLd), JSON.stringify(again.jsonLd));
  const shuffled = clone(manifest);
  shuffled.agents.reverse(); shuffled.activities.reverse(); shuffled.entities.reverse();
  for (const activity of shuffled.activities) { activity.used.reverse(); activity.wasAssociatedWith.reverse(); }
  const other = await projectProvenanceAsProvO(shuffled);
  assert.equal(other.turtle, first.turtle);
  assert.equal(JSON.stringify(other.jsonLd), JSON.stringify(first.jsonLd));
  assert.equal(other.canonicalNi, first.canonicalNi);
});

test("determinism: the input manifest is not mutated", async () => {
  const manifest = buildManifest(), before = JSON.stringify(manifest);
  await projectProvenanceAsProvO(manifest);
  checkProvenanceClosure(manifest);
  assert.equal(JSON.stringify(manifest), before);
});

test("JSON-LD: expanding it with a real processor gives the same RDF as the Turtle", async () => {
  const { turtle, jsonLd } = await projectProvenanceAsProvO(buildManifest());
  const nquads = await jsonld.toRDF(jsonLd, { format: "application/n-quads" });
  assert.equal(await canonicalizeNQuads(nquads), turtle);
});

test("an entity may be referenced by its ni as well as its id", async () => {
  const manifest = buildManifest();
  const intro = manifest.entities.find((entity) => entity.id === "manuscript/00-intro.md");
  manifest.activities[1].used[0] = intro.ni;
  const result = await projectProvenanceAsProvO(manifest);
  assert.equal(result.ok, true);
  assert.equal(result.turtle, readFileSync(GOLDEN, "utf8"));
});

test("a manifest without a baseIri mints under urn:provenance:", async () => {
  const manifest = buildManifest();
  delete manifest.baseIri;
  const { turtle } = await projectProvenanceAsProvO(manifest);
  assert.match(turtle, /<urn:provenance:agent\/claude>/u);
});

// ---- closure failures ----

const kinds = (result) => result.gaps.map((gap) => `${gap.severity}:${gap.kind}`);

test("closure: the fixture closes with no gaps; its roots are the inputs", () => {
  const result = checkProvenanceClosure(buildManifest());
  assert.deepEqual(result.gaps, []);
  assert.equal(result.closed, true);
  assert.deepEqual(result.summary.roots, ["build.sh", "references.yaml", "styles/minimal.csl"]);
});

test("closure: a derived entity no activity generated", () => {
  const manifest = buildManifest();
  manifest.activities[1].generated = [];
  const result = checkProvenanceClosure(manifest);
  assert.equal(result.closed, false);
  assert.ok(kinds(result).includes("error:derived-entity-without-generating-activity"));
});

test("closure: undeclared used and generated entities", () => {
  const manifest = buildManifest();
  manifest.activities[0].used.push("missing.md");
  manifest.activities[0].generated.push("ghost.pdf");
  const result = checkProvenanceClosure(manifest);
  assert.deepEqual(kinds(result), ["error:generated-entity-undeclared", "error:used-entity-undeclared"]);
  assert.equal(result.gaps[1].reference, "missing.md");
});

test("closure: unresolved derivation, attribution, association, delegation and plan", () => {
  const manifest = buildManifest();
  entityNamed(manifest, "build/manuscript.html").wasDerivedFrom.push("nowhere");
  entityNamed(manifest, "manuscript/00-intro.md").wasAttributedTo.push("nobody");
  manifest.activities[0].wasAssociatedWith.push({ agent: "stranger", role: "reviewer" });
  manifest.agents[1].actedOnBehalfOf = "absent";
  manifest.activities[1].plan = "no-such-script";
  const result = checkProvenanceClosure(manifest);
  assert.deepEqual(kinds(result), [
    "error:association-agent-undeclared", "error:attribution-agent-undeclared", "error:delegation-agent-undeclared",
    "error:derivation-unresolved", "error:plan-undeclared",
  ]);
});

test("closure: cycles, duplicate ids, reversed time", () => {
  const manifest = buildManifest();
  entityNamed(manifest, "manuscript/00-intro.md").wasDerivedFrom = ["build/manuscript.html"];
  manifest.agents[0].actedOnBehalfOf = "claude";
  manifest.agents.push({ id: "claude", name: "Claude again", kind: "software" });
  manifest.activities[0].endedAt = "2026-10-20T08:00:00Z";
  const found = kinds(checkProvenanceClosure(manifest));
  for (const expected of ["error:derivation-cycle", "error:delegation-cycle", "error:duplicate-id", "error:activity-ends-before-start"]) assert.ok(found.includes(expected), expected);
});

test("closure: warnings do not open the record", () => {
  const manifest = buildManifest();
  delete manifest.agents[1].actedOnBehalfOf;
  manifest.activities[1].used = manifest.activities[1].used.slice(1);
  manifest.activities[1].wasAssociatedWith = [];
  const result = checkProvenanceClosure(manifest);
  assert.equal(result.closed, true);
  assert.deepEqual(kinds(result), ["warning:ai-system-without-accountable-agent", "warning:derivation-not-used-by-generator", "warning:plan-without-association"]);
});

test("projection refuses a manifest that is not closed, naming the gaps", async () => {
  const manifest = buildManifest();
  manifest.activities[0].used.push("missing.md");
  const result = await projectProvenanceAsProvO(manifest);
  assert.equal(result.ok, false);
  assert.equal(result.refusal.reason, "ProvenanceNotClosed");
  assert.equal(result.refusal.gaps[0].kind, "used-entity-undeclared");
});

test("projection and closure refuse a manifest that breaks the schema", async () => {
  const manifest = buildManifest();
  manifest.entities[0].ni = "ni:///sha-256;short";
  assert.equal((await projectProvenanceAsProvO(manifest)).refusal.reason, "InvalidManifest");
  assert.equal(checkProvenanceClosure({ agents: [] }).refusal.reason, "InvalidManifest");
  assert.equal(checkProvenanceClosure(null).refusal.reason, "InvalidManifest");
  const kind = buildManifest();
  kind.agents[0].kind = "robot";
  assert.equal(checkProvenanceClosure(kind).refusal.reason, "InvalidManifest");
});

// ---- computeFileProvenanceEntities ----

const b64 = (text) => Buffer.from(text).toString("base64");

test("computeFileProvenanceEntities: NI, size and media type, sorted by path", () => {
  const result = computeFileProvenanceEntities({ files: [
    { path: "z/last.md", bytesBase64: b64("abc") },
    { path: "a.bin", bytesBase64: "" },
    { path: "figure.png", bytesBase64: b64("png"), mediaType: "image/x-custom", license: "MIT" },
  ] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.entities.map((entity) => entity.path), ["a.bin", "figure.png", "z/last.md"]);
  assert.equal(result.entities[0].ni, "ni:///sha-256;47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
  assert.equal(result.entities[0].bytes, 0);
  assert.equal(result.entities[0].mediaType, "application/octet-stream");
  assert.equal(result.entities[1].mediaType, "image/x-custom");
  assert.equal(result.entities[2].ni, `ni:///sha-256;${createHash("sha256").update("abc").digest("base64url")}`);
  assert.equal(result.entities[2].mediaType, "text/markdown");
  assert.equal(result.entities[2].id, "z/last.md");
});

test("original file-entity operation passes through source-use testimony without inventing a license", () => {
  const r = computeFileProvenanceEntities({ files: [{
    path: "source.csv", bytesBase64: "YQ==", mediaType: "text/csv",
    usageInfo: "https://aa.usno.navy.mil/about/PrivacyNotice",
    rights: "Upstream source credits requested; not an open license",
    creditText: "U.S. Naval Observatory",
  }] });
  assert.equal(r.ok, true);
  const e = r.entities[0];
  assert.equal(e.usageInfo, "https://aa.usno.navy.mil/about/PrivacyNotice");
  assert.equal(e.rights, "Upstream source credits requested; not an open license");
  assert.equal(e.creditText, "U.S. Naval Observatory");
  assert.equal(Object.hasOwn(e, "license"), false);
});

test("computeFileProvenanceEntities: refusals", () => {
  const reason = (files) => computeFileProvenanceEntities({ files }).refusal.reason;
  assert.equal(reason([{ path: "/abs.md", bytesBase64: "" }]), "InvalidPath");
  assert.equal(reason([{ path: "../up.md", bytesBase64: "" }]), "InvalidPath");
  assert.equal(reason([{ path: "a//b.md", bytesBase64: "" }]), "InvalidPath");
  assert.equal(reason([{ path: "a.md", bytesBase64: "not base64!" }]), "InvalidBase64");
  assert.equal(reason([{ path: "a.md", bytesBase64: "" }, { path: "a.md", bytesBase64: "" }]), "DuplicatePath");
  assert.equal(reason([{ path: "a.md", id: "x", bytesBase64: "" }, { path: "b.md", id: "x", bytesBase64: "" }]), "DuplicateId");
  assert.equal(computeFileProvenanceEntities({}).refusal.reason, "InvalidRequest");
});

test("computeFileProvenanceEntities output feeds the manifest unchanged", async () => {
  const { entities } = computeFileProvenanceEntities({ files: [{ path: "a.md", bytesBase64: b64("a") }, { path: "b.html", bytesBase64: b64("b"), wasDerivedFrom: ["a.md"] }] });
  const manifest = { agents: [{ id: "pandoc", name: "pandoc", kind: "software" }], entities, activities: [{ id: "r", label: "r", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:01Z", used: ["a.md"], generated: ["b.html"], wasAssociatedWith: [{ agent: "pandoc", role: "renderer" }] }] };
  assert.equal((await projectProvenanceAsProvO(manifest)).ok, true);
});

// ---- the command faces ----

function command(script, inputs) {
  const run = spawnSync(process.execPath, [here(`../scripts/${script}.mjs`)], { input: inputs.map((value) => JSON.stringify(value)).join("\n") + "\n", encoding: "utf8" });
  return { status: run.status, lines: run.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)), stderr: run.stderr };
}

test("command: compute-file-provenance-entities reads one JSON value per line", () => {
  const { status, lines } = command("compute-file-provenance-entities", [{ files: [{ path: "a.md", bytesBase64: b64("abc") }] }, { files: [{ path: "/bad", bytesBase64: "" }] }]);
  assert.equal(lines[0].ok, true);
  assert.equal(lines[0].entities[0].ni, `ni:///sha-256;${createHash("sha256").update("abc").digest("base64url")}`);
  assert.deepEqual(lines[1], { ok: false, refusal: { reason: "InvalidPath", message: lines[1].refusal.message } });
  assert.equal(status, 0);
});

test("command: check-provenance-closure and project-provenance-as-prov-o", () => {
  const open = buildManifest();
  open.activities[0].used.push("missing.md");
  const closure = command("check-provenance-closure", [buildManifest(), open, { nope: true }]);
  assert.equal(closure.lines[0].closed, true);
  assert.equal(closure.lines[1].closed, false);
  assert.equal(closure.lines[2].ok, false);
  assert.equal(closure.lines[2].refusal.reason, "InvalidInput");
  const projection = command("project-provenance-as-prov-o", [buildManifest()]);
  assert.equal(projection.lines[0].turtle, readFileSync(GOLDEN, "utf8"));
  assert.equal(projection.status, 0);
});

test("command: --help names the operation", () => {
  const run = spawnSync(process.execPath, [here("../scripts/project-provenance-as-prov-o.mjs"), "--help"], { encoding: "utf8" });
  assert.match(run.stdout, /^projectProvenanceAsProvO/u);
});

// ---- the pandoc build receipt shape ----

test("a project-document-through-pandoc build receipt's provenance block is a closed manifest fragment", async () => {
  const receipt = JSON.parse(readFileSync(here("fixtures/pandoc-build-receipt.json"), "utf8"));
  const manifest = { ...receipt.provenance, agents: [...receipt.provenance.agents, { id: "emsenn", name: "Morgan Sennhauser", kind: "person" }] };
  manifest.agents.find((agent) => agent.id === "pandoc").actedOnBehalfOf = "emsenn";
  const closure = checkProvenanceClosure(manifest);
  assert.equal(closure.closed, true, JSON.stringify(closure.gaps));
  assert.equal((await projectProvenanceAsProvO(manifest)).ok, true);
});
