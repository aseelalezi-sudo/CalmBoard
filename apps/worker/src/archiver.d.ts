declare module "archiver" {
  import type { Readable, Writable } from "node:stream";

  type EntrySource = string | Uint8Array | Readable;
  type EntryOptions = { name: string };

  interface Archiver {
    pipe(destination: Writable): Writable;
    directory(directoryPath: string, destinationPath: string | false): Archiver;
    append(source: EntrySource, options: EntryOptions): Archiver;
    finalize(): Promise<void>;
    on(event: "warning" | "error", listener: (error: Error & { code?: string }) => void): Archiver;
  }

  export default function archiver(format: "zip", options?: { zlib?: { level?: number } }): Archiver;
}
