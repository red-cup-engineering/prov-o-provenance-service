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
