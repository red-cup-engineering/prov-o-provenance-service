#!/usr/bin/env node
import { manifestSchema } from "../src/manifest.mjs";
import { assessProvenanceRevisionImpact } from "../src/closure.mjs";
import { resultSchema, runCommand } from "../src/command.mjs";

export { assessProvenanceRevisionImpact };

export const operationDefinition = {
  name: "assessProvenanceRevisionImpact",
  description: "Given two closed editions of one PROV manifest, identify source, producer and rights changes and trace the possible downstream research objects requiring independent review; does not decide truth.",
  inputSchema: {
    type: "object",
    required: ["previous", "current"],
    additionalProperties: false,
    properties: { previous: manifestSchema, current: manifestSchema },
  },
  outputSchema: resultSchema,
  operation: assessProvenanceRevisionImpact,
};
export const operation = operationDefinition;

if (import.meta.main) await runCommand(operationDefinition);
