import { apiServiceUrl } from "@/lib/client-api";
import { headers } from "next/headers";

export type AdminOverview = {
  counts: {
    users: number;
    organizations: number;
    workspaces: number;
    projects: number;
    tasks: number;
    docs: number;
    goals: number;
    automations: number;
    forms: number;
    timeLogs: number;
    activities: number;
    invoices: number;
  };
  organizations: Array<{ id: string; name: string; slug: string; plan: string; seats: number }>;
};

export async function getAdminOverview() {
  const cookie = (await headers()).get("cookie") ?? "";
  const response = await fetch(apiServiceUrl("/admin/overview"), {
    cache: "no-store",
    headers: { cookie },
  });
  if (!response.ok) throw new Error(`Admin overview request failed with status ${response.status}`);
  return response.json() as Promise<AdminOverview>;
}
