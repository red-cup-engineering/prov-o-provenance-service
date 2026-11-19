#!/usr/bin/env node
import { computeFileOriginEntities } from "../src/file-entities.mjs";
import { resultSchema, runCommand } from "../src/command.mjs";

export { computeFileOriginEntities };

export const operationDefinition = {
  name: "computeFileProvenanceEntities",
  description: "Computes the ni: content address, byte size and media type of files given as relative paths and base64 bytes, as provenance manifest entities.",
  inputSchema: {
    type: "object",
    required: ["files"],
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "bytesBase64"],
          properties: {
            path: { type: "string" },
            bytesBase64: { type: "string" },
            mediaType: { type: "string" },
            id: { type: "string" },
          },
        },
      },
    },
  },
  outputSchema: resultSchema,
  operation: computeFileOriginEntities,
};
export const operation = operationDefinition;

if (import.meta.main) await runCommand(operationDefinition);
