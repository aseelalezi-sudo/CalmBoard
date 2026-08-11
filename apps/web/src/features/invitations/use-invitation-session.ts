"use client";

import { getCurrentSession } from "@/features/workspace/api";

export function getInvitationSession() {
  return getCurrentSession();
}
