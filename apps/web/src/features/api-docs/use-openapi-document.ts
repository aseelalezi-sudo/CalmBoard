import { useCallback, useEffect, useRef, useState } from "react";
import { getOpenApiDocument, type OpenApiDocument } from "@/features/api-docs/api";
export type { OpenApiOperation, OpenApiSchema } from "@/features/api-docs/api";

export function useOpenApiDocument() {
  const [document, setDocument] = useState<OpenApiDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const doc = await getOpenApiDocument();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setDocument(doc);
    } catch {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError("تعذر تحميل مرجع واجهة البرمجة");
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [load]);

  return { document, loading, error, reload: load };
}
