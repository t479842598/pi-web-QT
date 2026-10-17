"use client";

/**
 * Model discovery for one provider draft.
 *
 * WHY this is a hook and not whatever the detail pane already does: the setup
 * sheet asks the endpoint for its model list on every keystroke pause, must
 * paint the models already stored in models.json while that request is in
 * flight, and must drop the answer of a request whose form has already changed.
 * All three are ordering problems, so they live in one place instead of being
 * re-derived at each call site.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { describeModelsFetchError, type ModelsFetchErrorKind } from "@/lib/model-fetch-error";
import { normalizeEndpointUrl } from "@/lib/provider-presets";

export type ProviderModelsSource = "saved" | "remote";

export interface ProviderModelsState {
  status: "idle" | "loading" | "ready" | "error";
  models: { id: string; name?: string }[];
  error?: string;
  errorKind?: ModelsFetchErrorKind;
  source?: ProviderModelsSource;
  /** 服务端实际回答的列表端点 */
  endpoint?: string;
}

export interface ProviderModelsForm {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  api: string;
  headers?: Record<string, string>;
}

export interface ProviderModelsDiscovery extends ProviderModelsState {
  reload: () => void;
  canReload: boolean;
}

/**
 * Long enough that a pasted key is not probed on every character, short enough
 * that the form does not feel like it is waiting on a button.
 */
export const FETCH_DEBOUNCE_MS = 600;

const IDLE: ProviderModelsState = { status: "idle", models: [] };

function toModels(list: readonly { id: string; name?: string }[] | undefined): { id: string; name?: string }[] {
  return (list ?? [])
    .filter((model) => typeof model.id === "string" && model.id.trim())
    .map((model) => ({ id: model.id, ...(model.name ? { name: model.name } : {}) }));
}

export function useProviderModels(
  active: boolean,
  form: ProviderModelsForm,
  savedModels?: readonly { id: string; name?: string }[],
): ProviderModelsDiscovery {
  const [state, setState] = useState<ProviderModelsState>(IDLE);

  // The sequence counter is what makes a late answer harmless: a response may
  // only write state while it is still the newest request.
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const { providerName, baseUrl, apiKey, api } = form;
  const headers = form.headers;
  const headersKey = headers ? JSON.stringify(headers) : "";
  const savedModelsKey = (savedModels ?? []).map((model) => model.id).join("\u0000");
  // Spec contract: reload is offered whenever the sheet is open and the base
  // URL parses. A keyless endpoint (Ollama, an internal gateway) is a real
  // target, so the button must not be disabled for want of a key.
  const canReload = active && Boolean(normalizeEndpointUrl(baseUrl));

  const cancelPending = useCallback(() => {
    requestSeq.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const fetchOnce = useCallback(async () => {
    const id = ++requestSeq.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const trimmedBaseUrl = baseUrl.trim();
    const trimmedApiKey = apiKey.trim();

    // `models` is deliberately absent: the probe describes the endpoint, and
    // sending the draft's list would let an unsaved row reach the request path.
    const provider: Record<string, unknown> = { api };
    if (trimmedBaseUrl) provider.baseUrl = trimmedBaseUrl;
    if (trimmedApiKey) provider.apiKey = trimmedApiKey;
    if (headers && Object.keys(headers).length > 0) provider.headers = headers;

    const saved = toModels(savedModels);
    const hasSaved = saved.length > 0;
    // Paint the stored list only while there is no key to probe with. Once a
    // key is typed the user is asking about the endpoint, so "loading" is the
    // honest state — the stored list is a fallback, not a decoy.
    const paintSaved = hasSaved && !trimmedApiKey;

    setState((previous) => (paintSaved
      // Painting the stored list first is the point of the "saved" source: the
      // sheet opens with models the user can already see, and a slow or failed
      // probe then only adds a note instead of blanking them.
      ? { status: "ready", models: saved, source: "saved" }
      : { ...previous, status: "loading", error: undefined, errorKind: undefined }));

    try {
      const response = await fetch("/api/models-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider }),
        signal: controller.signal,
      });
      const data = await response.json() as {
        models?: { id: string; name?: string }[];
        endpoint?: string;
        error?: string;
        status?: number;
      };
      if (!mountedRef.current || requestSeq.current !== id) return;

      if (!response.ok || data.error || !data.models) {
        // The route wraps an upstream failure in a 502 and reports the real
        // status in `status`; classifying on that number is what turns a bad
        // key into "unauthorized" instead of an opaque upstream error.
        const failure = describeModelsFetchError(
          new Error(data.error ?? `HTTP ${response.status}`),
          typeof data.status === "number" ? data.status : response.status,
        );
        setState({
          status: "error",
          models: saved,
          error: failure.message,
          errorKind: failure.kind,
          ...(hasSaved ? { source: "saved" as const } : {}),
        });
        return;
      }

      setState({
        status: "ready",
        models: toModels(data.models),
        source: "remote",
        ...(data.endpoint ? { endpoint: data.endpoint } : {}),
      });
    } catch (error) {
      if (!mountedRef.current || requestSeq.current !== id) return;
      // An abort is this hook's own cancellation — never an error to show.
      if (controller.signal.aborted) return;
      const failure = describeModelsFetchError(error, undefined);
      setState({
        status: "error",
        models: saved,
        error: failure.message,
        errorKind: failure.kind,
        ...(hasSaved ? { source: "saved" as const } : {}),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, apiKey, baseUrl, headersKey, providerName, savedModelsKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // A form the sheet cannot use yet: no request, and nothing to show.
    cancelPending();
    if (!active || !normalizeEndpointUrl(baseUrl)) {
      setState(IDLE);
      return;
    }

    const saved = toModels(savedModels);

    // Editing an existing provider with no new key: show what models.json has,
    // then probe anyway — the route resolves the stored credential itself, and
    // a success replaces the list with the live one.
    setState(saved.length > 0 && !apiKey.trim()
      ? { status: "ready", models: saved, source: "saved" }
      : (previous) => ({ ...previous, status: "loading" as const, error: undefined, errorKind: undefined }));

    debounceRef.current = setTimeout(() => { void fetchOnce(); }, FETCH_DEBOUNCE_MS);

    return cancelPending;
    // `savedModelsKey` stands in for the array identity on purpose: callers
    // rebuild that array every render, and probing per render is a request loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, api, apiKey, baseUrl, headersKey, providerName, savedModelsKey, cancelPending, fetchOnce]);

  const reload = useCallback(() => {
    if (!active) return;
    cancelPending();
    void fetchOnce();
  }, [active, cancelPending, fetchOnce]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return { ...state, reload, canReload };
}
