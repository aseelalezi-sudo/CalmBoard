"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useUiStore } from "@/stores/ui-store";

export function AppProviders({ children }: { children: ReactNode }) {
  const hydratePreferences = useUiStore((state) => state.hydratePreferences);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  useEffect(() => {
    hydratePreferences();
  }, [hydratePreferences]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
