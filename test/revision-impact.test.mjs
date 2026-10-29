import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { analyzeAdmittedProvenanceRevision as impact } from "../src/revision-impact.mjs";

const ni = value => "ni:///sha-256;" + createHash("sha256").update(value).digest("base64url");
const entity = (id, value, from = [], extras = {}) => ({
  id, path: "data/" + id + ".json", ni: ni(value), bytes: Buffer.byteLength(value),
  mediaType: "application/json", wasDerivedFrom: from, wasAttributedTo: [], ...extras,
});
const activity = (id, used, generated, extras = {}) => ({
  id, label: id, startedAt: "2026-10-27T10:00:00Z", endedAt: "2026-10-27T10:01:00Z",
  used, generated, wasAssociatedWith: [], ...extras,
});
const manifest = (entities, activities = [], agents = []) => ({ baseIri: "https://example.org/prov/", agents, activities, entities });
const ids = result => result.affected.map(a => a.id);

test("astronomy: changed almanac requires checking still-unchanged model and paper", () => {
  const old = manifest([entity("usno", "2026-raw"), entity("geometry", "same model", ["usno"]), entity("paper", "same result", ["geometry"])],
    [activity("compare", ["usno"], ["geometry"]), activity("write", ["geometry"], ["paper"])]);
  const next = structuredClone(old); next.entities[0].ni = ni("2026-revised");
  const r = impact(old, next);
  assert.equal(r.ok, true);
  assert.deepEqual(r.directChanges.map(x => x.id), ["usno"]);
  assert.deepEqual(ids(r), ["geometry", "paper", "usno"]);
  assert.deepEqual(r.potentiallyStaleUnchanged, ["geometry", "paper"]);
  assert.deepEqual(r.affected.find(x => x.id === "paper").path, ["usno", "geometry", "paper"]);
  assert.match(r.boundary, /not a false claim/);
});

test("sociology: two observations from one document are not independent sources", () => {
  const old = manifest([entity("S22", "publisher-text"), entity("E02", "episode 2", ["S22"]),
    entity("E03", "episode 3", ["S22"]), entity("interpretation", "claim", ["E02", "E03"])],
    [activity("code-2", ["S22"], ["E02"]), activity("code-3", ["S22"], ["E03"]),
      activity("synthesize", ["E02", "E03"], ["interpretation"])]);
  const next = structuredClone(old); next.entities[0].ni = ni("publisher-edited");
  const r = impact(old, next);
  assert.deepEqual(r.directChanges.map(x => x.id), ["S22"]);
  assert.deepEqual(ids(r), ["E02", "E03", "S22", "interpretation"]);
  assert.equal(r.affected.find(x => x.id === "interpretation").unchangedBytes, true);
});

test("declaration order cannot fabricate evidence differences", () => {
  const old = manifest([entity("a", "A"), entity("b", "B"), entity("c", "C", ["a", "b"])], [activity("make", ["a", "b"], ["c"])]);
  const next = structuredClone(old); next.entities.reverse(); next.activities.reverse();
  const r = impact(old, next);
  assert.equal(r.disposition, "no-affected-entities-detected");
  assert.deepEqual(r.affected, []);
});

test("source rights change propagates review even with identical bytes", () => {
  const old = manifest([entity("source", "stable", [], { license: "CC-BY-4.0" }), entity("output", "same", ["source"])],
    [activity("render", ["source"], ["output"])]);
  const next = structuredClone(old); next.entities[0].license = "all-rights-reserved";
  const r = impact(old, next);
  assert.deepEqual(r.directChanges[0].reasons, ["entity-provenance-or-rights-changed"]);
  assert.ok(r.potentiallyStaleUnchanged.includes("output"));
});

test("a corrected source-use notice and credit re-open derived research without changed bytes", () => {
  // This is a deliberate hypothetical correction, NOT evidence USNO's notice changed.
  const policy = "https://aa.usno.navy.mil/about/PrivacyNotice";
  const previous = manifest([
    entity("reference", "same computed almanac", [], {
      usageInfo: policy, rights: "Public site information, exceptions may apply",
      creditText: "U.S. Naval Observatory",
    }),
    entity("analysis", "identical derived calculations", ["reference"]),
    entity("unrelated", "unrelated source"),
  ], [activity("analyze", ["reference"], ["analysis"])]);
  const current = structuredClone(previous);
  current.entities[0].rights = "Updated source-use statement, requires review";
  current.entities[0].creditText = "U.S. Naval Observatory, Astronomical Applications Department";
  const result = impact(previous, current);
  assert.equal(result.ok, true);
  assert.deepEqual(result.directChanges.map(x => x.id), ["reference"]);
  assert.deepEqual(result.directChanges[0].reasons, ["entity-provenance-or-rights-changed"]);
  assert.deepEqual(ids(result), ["analysis", "reference"]);
  assert.deepEqual(result.potentiallyStaleUnchanged, ["analysis"]);
  assert.equal(result.affected.find(x => x.id === "analysis").sourceOfChange, "reference");
  assert.equal(result.affected.find(x => x.id === "analysis").unchangedBytes, true);
  assert.equal(result.affected.some(x => x.id === "unrelated"), false);
  assert.equal(previous.entities[0].rights, "Public site information, exceptions may apply");
});

test("changing only an official usage notice URL triggers review; unchanged metadata never does", () => {
  const old = manifest([
    entity("reference", "same bytes", [], {
      usageInfo: "https://example.org/notice/v1",
      rights: "Documented conditional reuse", creditText: "Reference author",
    }),
    entity("report", "same output", ["reference"]),
  ], [activity("publish", ["reference"], ["report"])]);
  const unchanged = structuredClone(old);
  assert.deepEqual(impact(old, unchanged).affected, []);
  const updated = structuredClone(old);
  updated.entities[0].usageInfo = "https://example.org/notice/v2";
  const result = impact(old, updated);
  assert.deepEqual(result.directChanges.map(x => x.id), ["reference"]);
  assert.deepEqual(result.potentiallyStaleUnchanged, ["report"]);
});

test("changed activity metadata qualifies descendants for review", () => {
  const old = manifest([entity("source", "source"), entity("calc", "same", ["source"]), entity("paper", "same", ["calc"])],
    [activity("compute", ["source"], ["calc"]), activity("report", ["calc"], ["paper"])]);
  const next = structuredClone(old); next.activities[0].label = "updated-method";
  const r = impact(old, next);
  assert.deepEqual(r.changedActivities, ["compute"]);
  assert.ok(r.directChanges.some(x => x.id === "calc" && x.reasons.includes("generating-activity-changed")));
  assert.ok(r.potentiallyStaleUnchanged.includes("paper"));
});

test("unrelated source paths remain unaffected", () => {
  const old = manifest([entity("a", "source A"), entity("b", "source B"), entity("x", "X", ["a"]), entity("y", "Y", ["b"])],
    [activity("a2x", ["a"], ["x"]), activity("b2y", ["b"], ["y"])]);
  const next = structuredClone(old); next.entities[0].ni = ni("source A revised");
  assert.deepEqual(ids(impact(old, next)), ["a", "x"]);
});

test("removed historical evidence retains retirement impact", () => {
  const old = manifest([entity("ref", "archived"), entity("analysis", "old", ["ref"])], [activity("run", ["ref"], ["analysis"])]);
  const r = impact(old, manifest([]));
  assert.deepEqual(r.directChanges.map(x => x.id), ["analysis", "ref"]);
  assert.ok(r.affected.every(x => !x.existsInCurrent));
});

test("activity usage/generation alone gives a conservative dependency witness", () => {
  const old = manifest([entity("input", "v1"), entity("output", "fixed")], [activity("build", ["input"], ["output"])]);
  const next = structuredClone(old); next.entities[0].ni = ni("v2");
  const r = impact(old, next);
  assert.ok(r.potentiallyStaleUnchanged.includes("output"));
  assert.deepEqual(r.affected.find(x => x.id === "output").edgeKinds[0], ["prov:used/wasGeneratedBy"]);
});

test("bad inputs and over-budget graphs refuse", () => {
  assert.equal(impact(null, manifest([])).refusal.reason, "ImpactInputInvalid");
  assert.equal(impact(manifest([entity("x", "1"), entity("x", "2")]), manifest([])).refusal.reason, "ImpactInputInvalid");
  const huge = manifest(Array.from({ length: 10001 }, (_, i) => entity("x" + i, String(i))));
  assert.equal(impact(huge, manifest([])).refusal.reason, "ImpactBudgetExceeded");
});

test("oversized usage-to-generation products refuse before quadratic graph construction", () => {
  const source = Array.from({ length: 500 }, (_, i) => entity("s" + i, "s" + i));
  const targets = Array.from({ length: 500 }, (_, i) => entity("t" + i, "t" + i));
  const huge = manifest([...source, ...targets],
    [activity("dense", source.map(x => x.id), targets.map(x => x.id))]);
  assert.equal(impact(huge, manifest([])).refusal.reason, "ImpactBudgetExceeded");
});
