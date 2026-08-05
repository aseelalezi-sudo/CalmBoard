import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { enabledPublicFlag } from "./feature-flags.js";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function noOpButtons() {
  const sourceRoot = dirname(fileURLToPath(new URL("../components", import.meta.url)));
  const findings: string[] = [];
  for (const file of sourceFiles(sourceRoot)) {
    const text = readFileSync(file, "utf8");
    const syntax = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const inspect = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (node.tagName.getText(syntax) === "Btn") {
          const attributes = node.attributes.properties;
          const hasClick = attributes.some(
            (attribute) =>
              ts.isJsxAttribute(attribute) && ["onClick", "formAction"].includes(attribute.name.getText(syntax)),
          );
          const submits = attributes.some(
            (attribute) =>
              ts.isJsxAttribute(attribute) &&
              attribute.name.getText(syntax) === "type" &&
              attribute.initializer !== undefined &&
              ts.isStringLiteral(attribute.initializer) &&
              ["submit", "reset"].includes(attribute.initializer.text),
          );
          if (!hasClick && !submits) {
            const line = syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1;
            findings.push(`${relative(sourceRoot, file)}:${line}`);
          }
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(syntax);
  }
  return findings;
}

describe("incomplete feature exposure", () => {
  it("keeps public feature flags disabled unless explicitly true", () => {
    for (const value of [undefined, "", "false", "1", "enabled"]) assert.equal(enabledPublicFlag(value), false);
    assert.equal(enabledPublicFlag(" TRUE "), true);
  });

  it("protects the WebAuthn preview with its explicit public flag", () => {
    const profile = source("../components/profile-security.tsx");
    const guide = source("../components/quick-guide.tsx");
    assert.match(profile, /webAuthnUiEnabled && \(/);
    assert.match(guide, /desc_ar: webAuthnUiEnabled/);
    assert.match(guide, /desc_en: webAuthnUiEnabled/);
  });

  it("does not expose the no-op generic integration button", () => {
    const integrations = source("../features/integrations/integrations-view.tsx");
    assert.doesNotMatch(integrations, /إضافة تكامل|Add integration/);
  });

  it("does not render shared buttons without a click or form action", () => {
    assert.deepEqual(noOpButtons(), []);
  });
});
