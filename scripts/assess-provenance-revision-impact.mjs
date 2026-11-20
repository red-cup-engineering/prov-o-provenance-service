#!/usr/bin/env node
import { manifestSchema } from "../src/manifest.mjs";
import { assessProvenanceRevisionImpact } from "../src/closure.mjs";
import { resultSchema, runCommand } from "../src/command.mjs";

export { assessProvenanceRevisionImpact };

export const operationDefinition = {
  name: "assessProvenanceRevisionImpact",
  description: "Compare two admitted PROV manifest editions, optionally qualifying an original SignChain sealed-history comparison with exact caller-provided proposition-to-entity bindings; trace review candidates without deciding scientific truth or source authenticity.",
  inputSchema: {
    type: "object",
    required: ["previous", "current"],
    additionalProperties: false,
    properties: {
      previous: manifestSchema, current: manifestSchema,
      // The original SignChain comparator remains owned by SignChain. This
      // operation only validates its reported addresses and the caller's
      // explicit mapping to already admitted PROV entity identities.
      signchainComparison: {
        type: "object",
        required: ["type", "monitoredPropositionCount", "changedPropositionAddresses", "comparisons"],
        properties: {
          type: { const: "signchain.originalEvidenceSnapshotComparison.v1" },
          monitoredPropositionCount: { type: "integer", minimum: 0, maximum: 128 },
          changedPropositionAddresses: { type: "array", maxItems: 128,
            items: { type: "string", minLength: 1, maxLength: 1024 } },
          comparisons: { type: "array", maxItems: 128, items: {
            type: "object", required: ["propositionAddress", "witnessesChanged",
              "observationsChanged", "requiresReverification"],
            additionalProperties: true,
            properties: {
              propositionAddress: { type: "string", minLength: 1, maxLength: 1024 },
              witnessesChanged: { type: "boolean" }, observationsChanged: { type: "boolean" },
              requiresReverification: { type: "boolean" },
            },
          } },
        },
        additionalProperties: true,
      },
      propositionEntities: { type: "array", maxItems: 128, items: {
        type: "object", additionalProperties: false,
        required: ["propositionAddress", "entityId"],
        properties: {
          propositionAddress: { type: "string", minLength: 1, maxLength: 1024 },
          entityId: { type: "string", minLength: 1, maxLength: 1024 },
        },
      } },
    },
  },
  outputSchema: resultSchema,
  operation: assessProvenanceRevisionImpact,
};
export const operation = operationDefinition;

if (import.meta.main) await runCommand(operationDefinition);
