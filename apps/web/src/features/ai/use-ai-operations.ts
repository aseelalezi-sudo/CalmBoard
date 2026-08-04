import { useState } from "react";
import { approveAIProposal, rejectAIProposal, runAiAction, type TenantScope } from "@/features/workspace/actions-api";
import type { AIActionProposal } from "./types";

export function useAiOperations(scope?: TenantScope & { projectId?: string }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<AIActionProposal | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);

  const run = async (action: string) => {
    setLoading(true);
    setError(null);
    setProposal(null);
    try {
      if (!scope) throw new Error("Select a workspace before using AI");
      const response = await runAiAction({ ...scope, action, text: input });
      setResult(typeof response.result === "string" ? response.result : JSON.stringify(response.result, null, 2));
      setProposal(response.proposal ?? null);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "AI provider is unavailable");
    } finally {
      setLoading(false);
    }
  };

  const approve = async () => {
    if (!scope || !proposal) return false;
    setProposalLoading(true);
    setError(null);
    try {
      const response = await approveAIProposal(scope, proposal);
      setProposal(null);
      setResult(`Created ${response.importedCount} task${response.importedCount === 1 ? "" : "s"}`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI proposal could not be approved");
      return false;
    } finally {
      setProposalLoading(false);
    }
  };

  const reject = async () => {
    if (!scope || !proposal) return;
    setProposalLoading(true);
    setError(null);
    try {
      await rejectAIProposal(scope, proposal);
      setProposal(null);
      setResult("Proposal rejected; no tasks were created");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI proposal could not be rejected");
    } finally {
      setProposalLoading(false);
    }
  };

  return { input, setInput, result, setResult, error, loading, run, proposal, proposalLoading, approve, reject };
}
