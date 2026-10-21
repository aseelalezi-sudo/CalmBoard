export const attachmentSignatureBytes = 16;

const startsWith = (head: Uint8Array, bytes: number[], offset = 0) =>
  head.length >= offset + bytes.length && bytes.every((byte, index) => head[offset + index] === byte);
const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

const zipContainer = (head: Uint8Array) =>
  startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06]);
const oleContainer = (head: Uint8Array) => startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
// Text attachments must not contain NUL bytes, which would indicate a binary payload with a text label.
const plainText = (head: Uint8Array) => head.length > 0 && !head.includes(0);

const signatureChecks: Record<string, (head: Uint8Array) => boolean> = {
  "application/pdf": (head) => startsWith(head, ascii("%PDF-")),
  "image/png": (head) => startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (head) => startsWith(head, [0xff, 0xd8, 0xff]),
  "image/gif": (head) => startsWith(head, ascii("GIF87a")) || startsWith(head, ascii("GIF89a")),
  "image/webp": (head) => startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8),
  "application/zip": zipContainer,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": zipContainer,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": zipContainer,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": zipContainer,
  "application/msword": oleContainer,
  "application/vnd.ms-excel": oleContainer,
  "application/vnd.ms-powerpoint": oleContainer,
  "text/plain": plainText,
  "text/csv": plainText,
};

// Types without a known signature (for example application/octet-stream) are not rejected here;
// they still pass through the mandatory malware scan.
export function contentMatchesMimeType(mimeType: string, head: Uint8Array) {
  const check = signatureChecks[mimeType.toLowerCase()];
  return check ? check(head) : true;
}
