import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assessProvenanceRevisionImpact } from "../index.mjs";

const ni = value => "ni:///sha-256;" + createHash("sha256").update(value).digest("base64url");
const source = value => ({ id: "reference", path: "data/reference.csv", ni: ni(value), bytes: Buffer.byteLength(value), mediaType: "text/csv" });
const output = () => ({ id: "paper", path: "paper.md", ni: ni("unrecomputed-analysis"), bytes: 21, mediaType: "text/markdown", wasDerivedFrom: ["reference"] });
const activity = () => ({ id: "analyze", label: "Analyze public source", startedAt: "2026-10-27T12:00:00Z", endedAt: "2026-10-27T12:01:00Z", used: ["reference"], generated: ["paper"] });
const old = () => ({ baseIri: "https://example.org/research/", agents: [], activities: [activity()], entities: [source("old public observation"), output()] });

test("native admission and closure give a reproducible changed-source impact", () => {
  const previous = old(), current = old();
  current.entities[0] = source("new public observation");
  const r = assessProvenanceRevisionImpact({ previous, current });
  assert.equal(r.ok, true);
  assert.deepEqual(r.directChanges.map(x => x.id), ["reference"]);
  assert.deepEqual(r.potentiallyStaleUnchanged, ["paper"]);
  assert.equal(r.affected.find(x => x.id === "paper").sourceOfChange, "reference");
});

test("bad schema and unresolved source identities refuse instead of reporting false closure", () => {
  assert.equal(assessProvenanceRevisionImpact({ previous: null, current: old() }).refusal.reason, "InvalidPreviousManifest");
  const broken = old();
  broken.entities[1].wasDerivedFrom = ["missing"];
  assert.equal(assessProvenanceRevisionImpact({ previous: broken, current: old() }).refusal.reason, "ProvenanceNotClosed");
});

test("two different logical entity namespaces cannot be compared by bare id", () => {
  const changed = old(); changed.baseIri = "https://other.example.org/research/";
  assert.equal(assessProvenanceRevisionImpact({ previous: old(), current: changed }).refusal.reason, "IncompatibleManifestBases");
});

test("two identical admitted editions do not invent an impact", () => {
  const r = assessProvenanceRevisionImpact({ previous: old(), current: old() });
  assert.equal(r.ok, true);
  assert.deepEqual(r.directChanges, []);
  assert.deepEqual(r.affected, []);
});

test("native provenance admission preserves external use notice revisions and refuses fabricated license surrogates", () => {
  const first = old();
  first.entities[0].usageInfo = "https://aa.usno.navy.mil/about/PrivacyNotice";
  first.entities[0].rights = "Public information subject to exceptions";
  first.entities[0].creditText = "U.S. Naval Observatory";
  const identical = structuredClone(first);
  assert.equal(assessProvenanceRevisionImpact({ previous: first, current: identical }).affected.length, 0);
  const revised = structuredClone(first);
  revised.entities[0].rights = "Corrected account of external source-use obligations";
  const result = assessProvenanceRevisionImpact({ previous: first, current: revised });
  assert.equal(result.ok, true);
  assert.deepEqual(result.directChanges.map(x => x.id), ["reference"]);
  assert.deepEqual(result.potentiallyStaleUnchanged, ["paper"]);
  assert.equal(first.entities[0].license, undefined, "source-use advice is not an invented license");
  for (const [key, value] of [
    ["usageInfo", "javascript:unsafe"], ["usageInfo", "https://example.org/space in URL"],
    ["rights", ""], ["creditText", ""],
  ]) {
    const inadmissible = structuredClone(first);
    inadmissible.entities[0][key] = value;
    assert.equal(assessProvenanceRevisionImpact({
      previous: first, current: inadmissible,
    }).refusal.reason, "InvalidCurrentManifest", key);
  }
});

test("two separate owners of identical bytes must not let declaration order hide affected scientific work", () => {
  // Reproduces the original provenance impact false-negative: identical
  // bytes occur in an owning Science CSV and an Engineering mirror, with
  // distinct logical ids but the same NI. A downstream derivation by bare
  // NI used to select the last declaration in the impact reader, whereas
  // the closure reader selected the first.
  const previous = old();
  const original = previous.entities[0];
  previous.entities.splice(1, 0, {
    ...structuredClone(original), id: "engineering-mirror",
    path: "engineer/reference.csv",
  });
  previous.activities[0].used = [original.ni];
  previous.entities[2].wasDerivedFrom = [original.ni];
  const changed = structuredClone(previous);
  changed.entities[0].rights = "Source use now calls for reassessment";
  for (const order of [false, true]) {
    const earlier = structuredClone(previous), later = structuredClone(changed);
    if (order) { earlier.entities.reverse(); later.entities.reverse(); }
    const screened = assessProvenanceRevisionImpact({ previous: earlier, current: later });
    assert.equal(screened.ok, false);
    assert.equal(screened.refusal.reason, "ProvenanceNotClosed");
    assert.equal(screened.refusal.edition, "previous");
    assert.ok(screened.refusal.gaps.some(gap => gap.kind === "ambiguous-content-address-reference"),
      "the impacted paper must not disappear merely because sources were reordered");
  }
});

test("rights metadata from two equal-byte source occurrences cannot be projected as one unqualified license", () => {
  const previous = old();
  previous.entities.push({ ...structuredClone(previous.entities[0]),
    id: "same-bytes-second-source", path: "another-source/reference.csv",
    license: "MIT", rights: "Different original source permission" });
  const r = assessProvenanceRevisionImpact({ previous, current: old() });
  assert.equal(r.ok, false);
  assert.equal(r.refusal.reason, "ProvenanceNotClosed");
  assert.ok(r.refusal.gaps.some(gap => gap.kind === "shared-content-rights-conflict"));
  // Removing the unqualified conflicting assertions restores admission of
  // distinct occurrence ids when all actual dependencies use logical IDs.
  delete previous.entities.at(-1).license;
  delete previous.entities.at(-1).rights;
  const fixed = assessProvenanceRevisionImpact({ previous, current: old() });
  assert.equal(fixed.ok, true, JSON.stringify(fixed.refusal));
});
