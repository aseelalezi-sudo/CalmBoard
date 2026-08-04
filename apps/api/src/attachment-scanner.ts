import { ServiceUnavailableException } from "@nestjs/common";

export type AttachmentScanInput = {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  downloadUrl: string;
};

export type AttachmentScanVerdict = {
  status: "clean" | "infected";
  engine: string;
  signature?: string;
};

type ScannerEnvironment = Partial<
  Record<"NODE_ENV" | "ATTACHMENT_SCAN_MODE" | "ATTACHMENT_SCANNER_URL" | "ATTACHMENT_SCANNER_TOKEN", string>
>;

export function createAttachmentScanner(
  env: ScannerEnvironment = process.env,
  fetchImplementation: typeof fetch = fetch,
) {
  const mode = env.ATTACHMENT_SCAN_MODE ?? (env.NODE_ENV === "production" ? "webhook" : "disabled");
  if (mode === "disabled") {
    if (env.NODE_ENV === "production") {
      throw new ServiceUnavailableException("Attachment scanning cannot be disabled in production");
    }
    return {
      async scan(): Promise<AttachmentScanVerdict> {
        return { status: "clean", engine: "development-disabled" };
      },
    };
  }
  if (mode !== "webhook" || !env.ATTACHMENT_SCANNER_URL) {
    throw new ServiceUnavailableException("Attachment scanner webhook is not configured");
  }

  return {
    async scan(input: AttachmentScanInput): Promise<AttachmentScanVerdict> {
      let response: Response;
      try {
        response = await fetchImplementation(env.ATTACHMENT_SCANNER_URL!, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(env.ATTACHMENT_SCANNER_TOKEN ? { Authorization: `Bearer ${env.ATTACHMENT_SCANNER_TOKEN}` } : {}),
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new ServiceUnavailableException("Attachment scanner is unavailable");
      }
      if (!response.ok) throw new ServiceUnavailableException("Attachment scanner rejected the request");
      const result = (await response.json()) as Partial<AttachmentScanVerdict>;
      if ((result.status !== "clean" && result.status !== "infected") || typeof result.engine !== "string") {
        throw new ServiceUnavailableException("Attachment scanner returned an invalid verdict");
      }
      return {
        status: result.status,
        engine: result.engine.slice(0, 100),
        ...(typeof result.signature === "string" ? { signature: result.signature.slice(0, 255) } : {}),
      };
    },
  };
}
