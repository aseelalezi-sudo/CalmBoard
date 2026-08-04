import { useEffect, useState } from "react";
import { getOpenApiDocument, type OpenApiDocument } from "@/features/api-docs/api";
export type { OpenApiOperation } from "@/features/api-docs/api";

export function useOpenApiDocument() {
  const [document, setDocument] = useState<OpenApiDocument | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOpenApiDocument()
      .then(setDocument)
      .finally(() => setLoading(false));
  }, []);

  return { document, loading };
}
