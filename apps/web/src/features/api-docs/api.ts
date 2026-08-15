import { requestJson } from "@/lib/client-api";

export type OpenApiSchema = {
  type?: string;
  format?: string;
  example?: unknown;
  enum?: unknown[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  $ref?: string;
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
        schema?: OpenApiSchema;
      };
    };
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: {
        "application/json"?: {
          schema?: OpenApiSchema;
        };
      };
    }
  >;
};

export type OpenApiDocument = {
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
};

export function getOpenApiDocument() {
  return requestJson<OpenApiDocument>("/api/docs/openapi");
}
