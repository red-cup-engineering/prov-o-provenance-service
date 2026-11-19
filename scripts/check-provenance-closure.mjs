#!/usr/bin/env node
import { manifestSchema } from "../src/manifest.mjs";
import { checkOriginClosure } from "../src/closure.mjs";
import { resultSchema, runCommand } from "../src/command.mjs";

export { checkOriginClosure };

export const operationDefinition = {
  name: "checkProvenanceClosure",
  description: "Checks that a build provenance manifest closes: derived entities have generating activities and every used, generated, derived-from, attributed-to, associated, delegated and plan reference is declared; reports each gap.",
  inputSchema: manifestSchema,
  outputSchema: resultSchema,
  operation: checkOriginClosure,
};
export const operation = operationDefinition;

if (import.meta.main) await runCommand(operationDefinition);
