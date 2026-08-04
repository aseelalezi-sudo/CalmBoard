import { apiServiceUrl, jsonRequest, requestJson } from "@/lib/client-api";
import type { FormField } from "@/lib/types";

export type PublicForm = {
  id: string;
  name: string;
  description?: string;
  fields: FormField[];
  isActive: boolean;
  submitLabel?: string;
  successMessage?: string;
  captcha: { enabled: false } | { enabled: true; siteKey: string | null; configured: boolean };
};

export async function getPublicForm(id: string) {
  const response = await requestJson<{ form?: PublicForm }>(apiServiceUrl(`/forms/${encodeURIComponent(id)}`));
  return response.form ?? null;
}

export function submitPublicForm(id: string, values: Record<string, string>, captchaToken: string) {
  return requestJson<{ responseId: string; taskCreationStatus: "not_requested" | "pending" }>(
    apiServiceUrl(`/forms/${encodeURIComponent(id)}/submit`),
    jsonRequest("POST", { values, captchaToken }),
  );
}
