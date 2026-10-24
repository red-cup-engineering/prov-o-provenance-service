#!/usr/bin/env node
import { composeProvenanceManifest } from "../src/compose.mjs";
import { resultSchema, runCommand } from "../src/command.mjs";

export { composeProvenanceManifest };

export const operationDefinition = {
  name: "composeProvenanceManifest",
  description: "Composes provenance manifest fragments (a renderer's build receipt, a paper's declared agents, an analysis run) into one admitted manifest: declarations sharing an id merge, list fields union, conflicting scalars refuse, and the result is ordered by id.",
  inputSchema: {
    type: "object",
    required: ["fragments"],
    properties: {
      fragments: { type: "array", minItems: 1, items: { type: "object" } },
      baseIri: { type: "string", minLength: 1 },
    },
  },
  outputSchema: resultSchema,
  operation: composeProvenanceManifest,
};

if (import.meta.main) await runCommand(operationDefinition);
