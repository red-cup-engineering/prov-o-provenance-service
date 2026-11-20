#!/usr/bin/env node
import { manifestSchema } from "../src/manifest.mjs";
import { projectProvenanceAsProvO } from "../src/prov-o.mjs";
import { resultSchema, runCommand } from "../src/command.mjs";

export { projectProvenanceAsProvO };

export const operationDefinition = {
  name: "projectProvenanceAsProvO",
  description: "Projects a build provenance manifest (agents, activities, entities) as W3C PROV-O, returning canonical Turtle and JSON-LD; refuses a manifest whose references do not resolve.",
  inputSchema: manifestSchema,
  outputSchema: resultSchema,
  operation: projectProvenanceAsProvO,
};
export const operation = operationDefinition;

if (import.meta.main) await runCommand(operationDefinition);
