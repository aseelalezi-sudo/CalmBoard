import { useCallback, useEffect, useRef, useState } from "react";
import {
  getQueueSnapshot,
  runQueueAction,
  runSecurityTests,
  type AdminJob,
  type QueueSnapshot,
  type SecurityTestReport,
} from "@/features/admin/api";

export function useAdminQueues() {
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [counts, setCounts] = useState<QueueSnapshot["counts"] | null>(null);
  const [redis, setRedis] = useState<QueueSnapshot["redis"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actionRef = useRef(false);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const snapshot = await getQueueSnapshot();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setJobs(snapshot.jobs ?? []);
      setCounts(snapshot.counts ?? null);
      setRedis(snapshot.redis ?? null);
    } catch {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError("تعذر تنفيذ إجراء الطابور");
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

  const act = async (action: string, jobId?: string) => {
    if (actionRef.current) return false;
    actionRef.current = true;
    setPendingAction(jobId ? `${action}:${jobId}` : action);
    setError(null);
    try {
      await runQueueAction(action, jobId);
      if (mountedRef.current) await load();
      return true;
    } catch {
      if (mountedRef.current) setError("تعذر تنفيذ إجراء الطابور");
      return false;
    } finally {
      actionRef.current = false;
      if (mountedRef.current) setPendingAction(null);
    }
  };

  const reload = () => load();

  return { jobs, counts, redis, loading, pendingAction, error, reload, act };
}

export function useSecurityTests() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SecurityTestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runRef = useRef(false);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const run = async () => {
    if (runRef.current) return false;
    runRef.current = true;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const result = await runSecurityTests();
      if (!mountedRef.current || requestId !== requestIdRef.current) return false;
      setReport(result);
      return true;
    } catch {
      if (!mountedRef.current || requestId !== requestIdRef.current) return false;
      setError("تعذر تشغيل فحص الأمان");
      return false;
    } finally {
      runRef.current = false;
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  };

  return { loading, report, error, run };
}
