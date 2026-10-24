import { computeFileProvenanceEntities } from "../src/file-entities.mjs";

const text = (value) => Buffer.from(value, "utf8").toString("base64");
const REVISION = "0123456789abcdef0123456789abcdef01234567";

/** A small, closed build: two sources and a style become an HTML manuscript under pandoc, with an AI research collaborator. */
export function buildManifest() {
  const { entities } = computeFileProvenanceEntities({
    files: [
      { path: "manuscript/00-intro.md", bytesBase64: text("# Introduction\n\nSee @smith2020.\n"), wasAttributedTo: ["claude", "emsenn"], license: "CC-BY-4.0",
        git: { repository: "lenticule-science/white-repopulation", revision: REVISION, path: "manuscript/00-intro.md", blob: "89abcdef0123456789abcdef0123456789abcdef" } },
      { path: "references.yaml", bytesBase64: text("references: []\n"), wasAttributedTo: ["emsenn"], license: "CC0-1.0" },
      { path: "styles/minimal.csl", bytesBase64: text("<style/>\n"), license: "https://creativecommons.org/publicdomain/zero/1.0/" },
      { path: "build.sh", bytesBase64: text("pandoc --citeproc\n"), mediaType: "application/x-sh" },
      { path: "build/manuscript.html", bytesBase64: text("<html></html>\n"), wasAttributedTo: ["emsenn"], license: "MIT",
        wasDerivedFrom: ["manuscript/00-intro.md", "references.yaml", "styles/minimal.csl"] },
    ],
  });
  return {
    baseIri: "https://example.org/prov/",
    agents: [
      { id: "emsenn", name: "Morgan Sennhauser", kind: "person" },
      { id: "claude", name: "Claude", kind: "ai-system", actedOnBehalfOf: "emsenn" },
      { id: "pandoc", name: "pandoc 3.1.3", kind: "software", actedOnBehalfOf: "emsenn" },
      { id: "https://561.group/id/organization/red-cup-engineering", name: "Red Cup Engineering", kind: "organization" },
    ],
    activities: [
      {
        id: "draft-intro", label: "Draft the introduction", startedAt: "2026-10-20T09:00:00Z", endedAt: "2026-10-20T11:30:00Z",
        used: ["references.yaml"], generated: ["manuscript/00-intro.md"],
        wasAssociatedWith: [{ agent: "emsenn", role: "author" }, { agent: "claude", role: "research-collaborator" }],
      },
      {
        id: "render-html", label: "Render HTML", startedAt: "2026-10-24T12:00:00Z", endedAt: "2026-10-24T12:00:02Z", plan: "build.sh",
        used: ["manuscript/00-intro.md", "references.yaml", "styles/minimal.csl"], generated: ["build/manuscript.html"],
        wasAssociatedWith: [{ agent: "pandoc", role: "renderer" }],
      },
    ],
    entities,
  };
}
