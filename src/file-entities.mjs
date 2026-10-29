import { addressContent } from "@red-cup-engineering/computer-content-address-engineering-services-section/content-address";
import { base64ToBytes } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { admitRelativePosixFilepath } from "@red-cup-engineering/computer-filepath-engineering-services-section/admit-relative-posix-filepath";
import { compare, refusal } from "./manifest.mjs";

const MEDIA_TYPES = Object.freeze({
  md: "text/markdown", markdown: "text/markdown", txt: "text/plain", tex: "application/x-tex", bib: "application/x-bibtex",
  json: "application/json", yaml: "application/yaml", yml: "application/yaml", csl: "application/vnd.citationstyles.style+xml",
  html: "text/html", htm: "text/html", xml: "application/xml", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  csv: "text/csv", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  pdf: "application/pdf", epub: "application/epub+zip", zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/** The media type the file extension names; application/octet-stream when it names none. */
export function mediaTypeForPath(path) {
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  return MEDIA_TYPES[extension] ?? "application/octet-stream";
}

/** Whether `path` is a normalized relative POSIX filepath beneath its root (the house filepath admission; a trailing slash names no file). */
function safePath(path) {
  try { admitRelativePosixFilepath(path); } catch { return false; }
  return !path.endsWith("/");
}

/** The bytes of canonical padded base64 text; undefined for anything else (the house `base64ToBytes` decodes). */
function decodeBase64(text) {
  return typeof text === "string" && BASE64.test(text) ? base64ToBytes(text) : undefined;
}

/**
 * Compute the NI content address and size of files given as relative paths and base64 bytes.
 * Entities come back in the shape of a provenance manifest entity, sorted by path.
 * @param {{files: {path: string, bytesBase64: string, mediaType?: string, id?: string, git?: object, license?: string, rights?: string, usageInfo?: string, creditText?: string, wasDerivedFrom?: string[], wasAttributedTo?: string[]}[]}} request
 * @returns {{ok: true, entities: object[]}|{ok: false, refusal: object}}
 */
export function computeFileProvenanceEntities(request) {
  if (request === null || typeof request !== "object" || !Array.isArray(request.files)) {
    return refusal("InvalidRequest", "request must be an object with a files array");
  }
  const entities = [], paths = new Set(), ids = new Set();
  for (const file of request.files) {
    if (file === null || typeof file !== "object") return refusal("InvalidRequest", "each file must be an object");
    if (!safePath(file.path)) return refusal("InvalidPath", `path ${JSON.stringify(file.path)} must be relative, "/"-separated and free of empty, "." and ".." segments`);
    if (paths.has(file.path)) return refusal("DuplicatePath", `path ${file.path} appears more than once`);
    paths.add(file.path);
    const bytes = decodeBase64(file.bytesBase64);
    if (bytes === undefined) return refusal("InvalidBase64", `bytesBase64 of ${file.path} is not canonical base64`);
    const mediaType = file.mediaType ?? mediaTypeForPath(file.path);
    const address = addressContent(bytes, { mediaType });
    const id = file.id ?? file.path;
    if (ids.has(id)) return refusal("DuplicateId", `entity id ${id} appears more than once`);
    ids.add(id);
    entities.push({
      id, path: file.path, ni: address.ni, bytes: address.size, mediaType,
      ...(file.git === undefined ? {} : { git: file.git }),
      wasDerivedFrom: file.wasDerivedFrom ?? [],
      wasAttributedTo: file.wasAttributedTo ?? [],
      ...(file.license === undefined ? {} : { license: file.license }),
      ...(file.rights === undefined ? {} : { rights: file.rights }),
      ...(file.usageInfo === undefined ? {} : { usageInfo: file.usageInfo }),
      ...(file.creditText === undefined ? {} : { creditText: file.creditText }),
    });
  }
  entities.sort((left, right) => compare(left.path, right.path));
  return Object.freeze({ ok: true, entities });
}
