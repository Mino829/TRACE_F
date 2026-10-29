"use client";

import { useEffect, useState } from "react";
import { OperatorSession, type OperatorStatus } from "@/lib/display/operator-session";

const BROKER_URL = (process.env.NEXT_PUBLIC_ARRIVAL_ISSUER_URL ?? "").replace(/\/$/, "");

export function useOperatorSession() {
  const [status, setStatus] = useState<OperatorStatus>({ state: "login", detail: null });
  const [session] = useState(() => BROKER_URL ? new OperatorSession(BROKER_URL, setStatus) : null);
  useEffect(() => () => session?.close(), [session]);
  return { session, ...status };
}
