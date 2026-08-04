"use client";

import { useEffect, useState } from "react";
import { emptyWorkspaceSearchResults, searchWorkspace, type SearchScope, type WorkspaceSearchResults } from "./api";

const SEARCH_DEBOUNCE_MS = 250;

export function useCommandSearch(input: { open: boolean; query: string; scope?: SearchScope; retryKey?: number }) {
  const { open, query, scope, retryKey = 0 } = input;
  const normalizedQuery = query.trim();
  const organizationId = scope?.organizationId;
  const workspaceId = scope?.workspaceId;
  const [results, setResults] = useState<WorkspaceSearchResults>(() => emptyWorkspaceSearchResults());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || normalizedQuery.length < 2 || !organizationId || !workspaceId) {
      setResults(emptyWorkspaceSearchResults());
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setResults(emptyWorkspaceSearchResults());
    setLoading(true);
    setError(null);

    const timer = window.setTimeout(() => {
      void searchWorkspace({ organizationId, workspaceId }, normalizedQuery, controller.signal)
        .then((nextResults) => {
          if (active) setResults(nextResults);
        })
        .catch((reason: unknown) => {
          if (!active || controller.signal.aborted) return;
          setError(reason instanceof Error ? reason.message : "Search request failed");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, open, organizationId, retryKey, workspaceId]);

  return { normalizedQuery, results, loading, error };
}
