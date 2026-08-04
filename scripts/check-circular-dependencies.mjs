import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["apps", "packages"]
  .map((directory) => join(repositoryRoot, directory))
  .filter((directory) => existsSync(directory));
const supportedExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const ignoredDirectories = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

function collectSourceFiles(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) collectSourceFiles(path, files);
    else if (supportedExtensions.includes(extname(path))) files.push(normalize(path));
  }
  return files;
}

const sourceFiles = sourceRoots.flatMap((directory) => collectSourceFiles(directory));
const sourceFileSet = new Set(sourceFiles);

function resolveFile(candidate) {
  const normalizedCandidate = normalize(candidate);
  const candidates = [
    normalizedCandidate,
    ...supportedExtensions.map((extension) => `${normalizedCandidate}${extension}`),
    ...supportedExtensions.map((extension) => join(normalizedCandidate, `index${extension}`)),
  ];
  return candidates.find((path) => sourceFileSet.has(path));
}

function resolveWorkspaceImport(importer, specifier) {
  if (specifier.startsWith(".")) return resolveFile(resolve(dirname(importer), specifier));

  if (specifier.startsWith("@/")) {
    const webSourceRoot = join(repositoryRoot, "apps", "web", "src");
    return resolveFile(join(webSourceRoot, specifier.slice(2)));
  }

  const workspacePackage = specifier.match(/^@calmboard\/([^/]+)(?:\/(.+))?$/);
  if (workspacePackage) {
    const [, packageName, subpath] = workspacePackage;
    return resolveFile(join(repositoryRoot, "packages", packageName, "src", subpath ?? "index"));
  }

  return undefined;
}

function importsFrom(source) {
  const withoutTypeOnlyImports = source
    .replace(/\bimport\s+type\b[\s\S]*?\bfrom\s*["'][^"']+["'];?/g, "")
    .replace(/\bexport\s+type\b[\s\S]*?\bfrom\s*["'][^"']+["'];?/g, "");
  const importPattern =
    /(?:\bimport\s+(?:[\s\S]*?\s+from\s+)?|\bexport\s+[\s\S]*?\s+from\s+|\bimport\s*\()\s*["']([^"']+)["']/g;
  return [...withoutTypeOnlyImports.matchAll(importPattern)].map((match) => match[1]);
}

const graph = new Map(
  sourceFiles.map((file) => {
    const dependencies = importsFrom(readFileSync(file, "utf8"))
      .map((specifier) => resolveWorkspaceImport(file, specifier))
      .filter(Boolean);
    return [file, [...new Set(dependencies)]];
  }),
);

const state = new Map();
const stack = [];
const cycles = new Map();

function visit(file) {
  state.set(file, "visiting");
  stack.push(file);

  for (const dependency of graph.get(file) ?? []) {
    if (state.get(dependency) === "visiting") {
      const start = stack.indexOf(dependency);
      const cycle = [...stack.slice(start), dependency];
      const labels = cycle.map((path) => relative(repositoryRoot, path).replaceAll("\\", "/"));
      const rotations = labels.slice(0, -1).map((_, index) => {
        const nodes = labels.slice(0, -1);
        const rotated = [...nodes.slice(index), ...nodes.slice(0, index)];
        return [...rotated, rotated[0]].join(" -> ");
      });
      cycles.set(rotations.sort()[0], labels.join(" -> "));
    } else if (!state.has(dependency)) {
      visit(dependency);
    }
  }

  stack.pop();
  state.set(file, "visited");
}

for (const file of sourceFiles) {
  if (!state.has(file)) visit(file);
}

if (cycles.size > 0) {
  console.error("Circular source dependencies found:");
  for (const cycle of cycles.values()) console.error(`- ${cycle}`);
  process.exit(1);
}

console.log(`No circular source dependencies found across ${sourceFiles.length} files.`);
