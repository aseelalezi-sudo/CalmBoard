import type { HealthResponse } from "@calmboard/types";

export type ApiClientOptions = {
  baseUrl: string;
  fetcher?: typeof fetch;
};

export function createApiClient({ baseUrl, fetcher = fetch }: ApiClientOptions) {
  const root = baseUrl.replace(/\/$/, "");

  return {
    async health(): Promise<HealthResponse> {
      const response = await fetcher(`${root}/health`);
      if (!response.ok) {
        throw new Error(`Health request failed with ${response.status}`);
      }
      return (await response.json()) as HealthResponse;
    },
  };
}
