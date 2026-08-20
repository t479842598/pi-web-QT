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
 * Field-level equality for balance payloads. The refresh callback must stay
 * referentially stable (its identity drives ChatWindow's refresh effect), so
 * it reads state through a ref and only calls setBalance when the data
 * actually changed — otherwise each fetch produces a new object identity and
 * retriggers the effect in an infinite fetch loop.
 */
export function sameDeepSeekBalance(a: DeepSeekBalanceData, b: DeepSeekBalanceData): boolean {
  return a.available === b.available
    && a.reason === b.reason
    && a.currency === b.currency
    && a.totalBalance === b.totalBalance
    && a.grantedBalance === b.grantedBalance
    && a.toppedUpBalance === b.toppedUpBalance;
}

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
        if (prev === null || !sameDeepSeekBalance(prev, data)) {
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