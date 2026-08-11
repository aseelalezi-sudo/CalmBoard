import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const roots = ["apps/web/src", "apps/api/src", "packages/notifications/src"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md"]);
const corruptionPatterns = [
  ["replacement character", /\uFFFD/gu, 1],
  ["Latin-1 UTF-8 mojibake", /[\u00C2\u00C3][\u0080-\u00FF]?/gu, 1],
  ["Windows punctuation mojibake", /\u00E2[\u0080-\u00BF]/gu, 1],
  // CP1256/Windows round-trips can turn Arabic UTF-8 bytes into repeated ط?/ظ? pairs.
  // Requiring two pairs avoids flagging valid Arabic that ends in ظ followed by an ellipsis.
  ["Arabic UTF-8 mojibake", /[\u0637\u0638][\u00A0-\u00FF\u2010-\u203A]/gu, 2],
];

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (sourceExtensions.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

export function scanEncodingContent(content) {
  const findings = [];
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    for (const [kind, pattern, minimumMatches] of corruptionPatterns) {
      if ((lines[index].match(pattern) ?? []).length >= minimumMatches) findings.push({ line: index + 1, kind });
    }
  }
  return findings;
}

export function scanUserFacingSources(root = process.cwd()) {
  const findings = [];
  for (const sourceRoot of roots) {
    const absoluteRoot = resolve(root, sourceRoot);
    for (const file of sourceFiles(absoluteRoot)) {
      const buffer = readFileSync(file);
      if (buffer.includes(0)) continue;
      const content = buffer.toString("utf8");
      const byteOrderMark = content.charCodeAt(0) === 0xfeff;
      if (byteOrderMark) findings.push({ file: relative(root, file), line: 1, kind: "UTF-8 BOM" });
      for (const finding of scanEncodingContent(content)) {
        findings.push({ file: relative(root, file), ...finding });
      }
    }
  }
  return findings;
}

function main() {
  const findings = scanUserFacingSources();
  if (findings.length === 0) {
    console.log("User-facing source encoding scan passed (UTF-8 without known mojibake patterns).");
    return;
  }
  console.error("Potential user-facing encoding corruption was found:");
  for (const finding of findings) console.error(`- ${finding.file}:${finding.line}: ${finding.kind}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
