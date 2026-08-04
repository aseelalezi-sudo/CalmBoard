import { requestJson } from "@/lib/client-api";

export type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    schemas: Record<string, { properties?: Record<string, OpenApiSchema> }>;
  };
};

export type OpenApiSchema = {
  type?: string;
  format?: string;
  example?: unknown;
};

export type OpenApiOperation = {
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    required?: boolean;
    description?: string;
    schema?: OpenApiSchema;
  }>;
  requestBody?: {
    content: {
      "application/json"?: {
        schema?: { properties?: Record<string, OpenApiSchema> };
      };
    };
  };
};

export function getOpenApiDocument() {
  return requestJson<OpenApiDocument>("/api/docs/openapi");
}
