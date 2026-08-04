export function documentTaskTitle(content: string | null | undefined, fallback: string) {
  const firstMeaningfulLine = (content ?? "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^```.*$/, "")
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s*/, "")
        .replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/, "")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[*_~`]/g, "")
        .trim(),
    )
    .find(Boolean);

  return (firstMeaningfulLine || fallback).slice(0, 100);
}
