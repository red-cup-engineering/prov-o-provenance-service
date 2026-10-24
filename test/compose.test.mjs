import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeProvenanceManifest } from "../src/compose.mjs";
import { checkProvenanceClosure } from "../src/closure.mjs";

const here = (path) => new URL(path, import.meta.url);
const receipt = JSON.parse(readFileSync(here("fixtures/pandoc-build-receipt.json"), "utf8"));
const people = {
  agents: [
    { id: "morgan", name: "Morgan Sennhauser", kind: "person" },
    { id: "codex", name: "Codex 6.1", kind: "ai-system", actedOnBehalfOf: "morgan" },
  ],
};

test("a renderer receipt and a paper's declared people compose into a closed manifest", () => {
  const result = composeProvenanceManifest({ fragments: [receipt.provenance, people] });
  assert.equal(result.ok, true, JSON.stringify(result.refusal));
  assert.ok(result.manifest.agents.some((agent) => agent.id === "codex"));
  assert.equal(checkProvenanceClosure(result.manifest).ok, true);
});

test("fragment order does not change the composed manifest", () => {
  const forward = composeProvenanceManifest({ fragments: [receipt.provenance, people] });
  const backward = composeProvenanceManifest({ fragments: [people, receipt.provenance] });
  assert.equal(JSON.stringify(forward), JSON.stringify(backward));
});

test("the same id merges list fields and refuses a conflicting scalar", () => {
  const entity = { id: "a", path: "a.md", ni: "ni:///sha-256;47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU", bytes: 0, mediaType: "text/markdown" };
  const merged = composeProvenanceManifest({ fragments: [
    { agents: [], activities: [], entities: [{ ...entity, wasAttributedTo: ["x"] }] },
    { agents: [{ id: "x", name: "X", kind: "person" }, { id: "y", name: "Y", kind: "person" }], activities: [], entities: [{ ...entity, wasAttributedTo: ["y"] }] },
  ] });
  assert.deepEqual(merged.manifest.entities[0].wasAttributedTo, ["x", "y"]);
  const conflict = composeProvenanceManifest({ fragments: [
    { agents: [], activities: [], entities: [entity] },
    { agents: [], activities: [], entities: [{ ...entity, bytes: 1 }] },
  ] });
  assert.equal(conflict.refusal.reason, "ConflictingDeclaration");
});

test("an empty request and differing base IRIs are refused", () => {
  assert.equal(composeProvenanceManifest({ fragments: [] }).refusal.reason, "InvalidRequest");
  assert.equal(composeProvenanceManifest({ fragments: [{ baseIri: "urn:a:" }, { baseIri: "urn:b:" }] }).refusal.reason, "ConflictingBaseIri");
});
