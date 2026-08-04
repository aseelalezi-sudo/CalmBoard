import sharp from "sharp";

const imageMimeTypes = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const sourcePreviewMimeTypes = new Set(["application/pdf", "text/csv", "text/plain"]);

type PreviewStorage = {
  readObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<string>;
};

export async function createAttachmentPreview(storage: PreviewStorage, input: { key: string; mimeType: string }) {
  if (sourcePreviewMimeTypes.has(input.mimeType)) {
    return { status: "source" as const, mimeType: input.mimeType };
  }
  if (!imageMimeTypes.has(input.mimeType)) return { status: "unsupported" as const };

  const original = await storage.readObject(input.key);
  const { data, info } = await sharp(original, { limitInputPixels: 40_000_000, animated: false })
    .rotate()
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const previewKey = `${input.key}.preview.webp`;
  return {
    status: "ready" as const,
    storageReference: await storage.putObject(previewKey, data, "image/webp"),
    mimeType: "image/webp",
    width: info.width,
    height: info.height,
  };
}
