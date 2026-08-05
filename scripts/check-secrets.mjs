import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const secretPatterns = [
  [
    "private key",
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/]{32,}={0,2}\r?\n)+-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  ],
  ["age private key", /\bAGE-SECRET-KEY-1[0-9A-Z]{20,}\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["GitHub token", /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{36,255}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["Stripe live secret", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
];

export function unsafeTrackedEnvironmentFile(file) {
  const name = basename(file).toLowerCase();
  return (name === ".env" || name.startsWith(".env.")) && !name.endsWith(".example");
}

export function scanSecretContent(content) {
  return secretPatterns.filter(([, pattern]) => pattern.test(content)).map(([name]) => name);
}

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

export function scanTrackedFiles(root = process.cwd()) {
  const findings = [];
  for (const file of trackedFiles(root)) {
    if (unsafeTrackedEnvironmentFile(file)) findings.push({ file, kind: "plaintext environment file" });
    const buffer = readFileSync(resolve(root, file));
    if (buffer.includes(0)) continue;
    for (const kind of scanSecretContent(buffer.toString("utf8"))) findings.push({ file, kind });
  }
  return findings;
}

function main() {
  const findings = scanTrackedFiles();
  if (findings.length === 0) {
    console.log("Tracked-file secret scan passed.");
    return;
  }
  console.error("Potential secrets were found in tracked files:");
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.kind}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
