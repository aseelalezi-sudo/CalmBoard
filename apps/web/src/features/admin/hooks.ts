import { useCallback, useEffect, useState } from "react";
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await getQueueSnapshot();
      setJobs(snapshot.jobs ?? []);
      setCounts(snapshot.counts ?? null);
      setRedis(snapshot.redis ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل حالة الطوابير");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: string, jobId?: string) => {
    setError(null);
    try {
      await runQueueAction(action, jobId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تنفيذ إجراء الطابور");
    }
  };

  return { jobs, counts, redis, loading, error, act };
}

export function useSecurityTests() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SecurityTestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await runSecurityTests());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "خطأ غير معروف");
    } finally {
      setLoading(false);
    }
  };

  return { loading, report, error, run };
}
