"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Balance data shape returned by GET /api/deepseek/balance. */
export interface DeepSeekBalanceData {
  available: boolean;
  reason?: string;
  currency?: string;
  totalBalance?: string;
  grantedBalance?: string;
  toppedUpBalance?: string;
}

const REFRESH_DEBOUNCE_MS = 2000;

/**
 * Fetch + state for the DeepSeek official wallet balance.
 *
 * - `refresh()`: immediate fetch. Success (available:true) replaces state;
 *   failures keep the previous value and flip `failed`.
 * - `refreshSoon()`: debounced (2s) refresh — paired with "turn finished"
 *   signals so a burst of messages triggers at most one request.
 * - The fetch is wrapped in an AbortController; state is never set after
 *   unmount.
 */
export function useDeepSeekBalance() {
  const [balance, setBalance] = useState<DeepSeekBalanceData | null>(null);
  const [failed, setFailed] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      controllerRef.current?.abort();
    };
  }, []);

  const balanceRef = useRef<DeepSeekBalanceData | null>(null);

  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const res = await fetch("/api/deepseek/balance", {
        signal: controller.signal,
        cache: "no-store",
      });
      const data = (await res.json()) as DeepSeekBalanceData;
      if (!mountedRef.current) return;
      if (data?.available && data.totalBalance != null) {
        // Field-level compare: replacing state with an identical-but-new object
        // would change this callback's identity and retrigger the caller's
        // refresh effect — an infinite fetch loop (see ChatWindow mount effect).
        const prev = balanceRef.current;
        const unchanged = prev !== null
          && prev.available === data.available
          && prev.reason === data.reason
          && prev.currency === data.currency
          && prev.totalBalance === data.totalBalance
          && prev.grantedBalance === data.grantedBalance
          && prev.toppedUpBalance === data.toppedUpBalance;
        if (!unchanged) {
          balanceRef.current = data;
          setBalance(data);
        }
        setFailed(false);
      } else if (balanceRef.current === null) {
        setFailed(true);
      }
    } catch {
      if (!mountedRef.current) return;
      if (balanceRef.current === null) setFailed(true);
    }
  }, []);

  const refreshSoon = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [refresh]);

  return { balance, failed, refresh, refreshSoon };
}