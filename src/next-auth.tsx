import React, {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
  useMemo,
} from "react";
import { configureAuthBaseURL, getAuthAxios } from "./axiosHelper";
import { removeData, saveData, getData } from "./storageHelper";

// ---------------------------------------------------------------------------
// Debug logging — gated by a flag. Defaults ON so the startup/auth sequence is
// visible while debugging; call `setNextAuthDebug(false)` to silence in prod.
// ---------------------------------------------------------------------------
let NEXTAUTH_DEBUG = true;
export const setNextAuthDebug = (enabled: boolean) => {
  NEXTAUTH_DEBUG = enabled;
};
const debugLog = (...args: unknown[]) => {
  if (NEXTAUTH_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[next-auth]", ...args);
  }
};

// ---------------------------------------------------------------------------
// Lightweight in-process event bus so signIn/signOut/update can notify the
// active SessionProvider.
// ---------------------------------------------------------------------------
type AuthEventListener = (data?: unknown) => void;
const authEventListeners: Record<string, AuthEventListener[]> = {};

const emitAuthEvent = (event: string, data?: unknown) => {
  authEventListeners[event]?.forEach((listener) => listener(data));
};

const addAuthEventListener = (event: string, listener: AuthEventListener) => {
  (authEventListeners[event] ??= []).push(listener);
};

const removeAuthEventListener = (event: string, listener: AuthEventListener) => {
  if (authEventListeners[event]) {
    authEventListeners[event] = authEventListeners[event].filter(
      (l) => l !== listener,
    );
  }
};

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

type SessionContextType = {
  data: unknown;
  status: SessionStatus;
};

export const SessionContext = createContext<SessionContextType | undefined>(
  undefined,
);

type SessionProviderProps = {
  children: ReactNode;
  baseURL?: string;
};

const hasValidSession = (sessionData: unknown) => {
  if (!sessionData || typeof sessionData !== "object") {
    return false;
  }
  return Boolean((sessionData as { user?: unknown }).user);
};

// ---------------------------------------------------------------------------
// Cookie helpers. The backend issues rolling session cookies; we persist the
// merged Cookie header so the rotating next-auth.session-token keeps working
// across requests and app launches.
// ---------------------------------------------------------------------------
const normalizeSetCookieHeader = (setCookieHeader: unknown): string | null => {
  if (Array.isArray(setCookieHeader)) {
    return setCookieHeader.join("; ");
  }
  if (typeof setCookieHeader === "string" && setCookieHeader.trim()) {
    return setCookieHeader;
  }
  return null;
};

const parseCookiePairs = (cookieHeaderValue: string) => {
  const cookieMap = new Map<string, string>();
  cookieHeaderValue
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes("="))
    .forEach((pair) => {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex <= 0) {
        return;
      }
      const key = pair.slice(0, separatorIndex).trim();
      if (!key) {
        return;
      }
      cookieMap.set(key, pair.slice(separatorIndex + 1));
    });
  return cookieMap;
};

const parseSetCookieLines = (rawCookies: string[]) => {
  const cookieMap = new Map<string, string>();
  rawCookies.forEach((cookie) => {
    const firstSegment = cookie.split(";")[0]?.trim();
    if (!firstSegment || !firstSegment.includes("=")) {
      return;
    }
    const separatorIndex = firstSegment.indexOf("=");
    const key = firstSegment.slice(0, separatorIndex).trim();
    if (!key) {
      return;
    }
    cookieMap.set(key, firstSegment.slice(separatorIndex + 1));
  });
  return cookieMap;
};

const toCookieHeaderValue = (cookieMap: Map<string, string>) =>
  Array.from(cookieMap.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ") || null;

const mergeCookieHeaders = (
  existingCookies: string | null,
  incomingSetCookie: string[],
) => {
  const existingMap = existingCookies
    ? parseCookiePairs(existingCookies)
    : new Map<string, string>();
  const incomingMap = parseSetCookieLines(incomingSetCookie);

  incomingMap.forEach((value, key) => {
    const isSessionTokenCookie = key.includes("next-auth.session-token");
    const isEmptyValue = value.trim().length === 0;
    // Never let an empty rotated session token clobber a good one.
    if (isSessionTokenCookie && isEmptyValue && existingMap.get(key)) {
      return;
    }
    existingMap.set(key, value);
  });

  return toCookieHeaderValue(existingMap);
};

const cookieNames = (cookieHeader: string | null) =>
  cookieHeader
    ? cookieHeader
        .split(";")
        .map((c) => c.split("=")[0]?.trim())
        .filter(Boolean)
    : [];

// Extract cookie names from a raw `set-cookie` response header (array or
// string) for logging — never logs the token values themselves.
const setCookieNames = (setCookie: unknown): string[] => {
  const lines = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" && setCookie.trim()
    ? [setCookie]
    : [];
  return lines
    .map((line) => String(line).split("=")[0]?.trim())
    .filter(Boolean) as string[];
};

// ---------------------------------------------------------------------------
// Session snapshot — the last validated session, cached so a returning user is
// shown home instantly on relaunch (optimistic hydration) while we re-validate
// in the background. Refreshed on every successful fetch; cleared on sign-out
// and on a definitive unauthorized.
// ---------------------------------------------------------------------------
const SESSION_SNAPSHOT_KEY = "sessionSnapshot";
const saveSessionSnapshot = (sessionData: unknown) =>
  saveData(SESSION_SNAPSHOT_KEY, sessionData);
const getSessionSnapshot = () => getData(SESSION_SNAPSHOT_KEY);
const clearSessionSnapshot = () => removeData(SESSION_SNAPSHOT_KEY);

// Clears every trace of the session (cookies + cached snapshot). Used on a
// definitive logout (sign-out, 401/403).
const clearSession = async () => {
  await removeData("sessionCookies");
  await clearSessionSnapshot();
};

// ---------------------------------------------------------------------------
// Session resolution. A single fetch is classified into a structured outcome;
// no React state or events are touched here, so the hydration controller (and
// signIn) stay the sole authority over status — this is what prevents the
// login flash on startup.
// ---------------------------------------------------------------------------
type SessionOutcome =
  | { status: "authenticated"; data: unknown }
  // 200 OK but no `user` yet — backend hasn't materialised the session. Retry.
  | { status: "transient" }
  // 401/403 — definitively logged out. Clear stale cookies, do not retry.
  | { status: "unauthorized" }
  // No cookies stored locally — definitively logged out. Nothing to clear.
  | { status: "no-session" }
  // Network / unexpected error. Retry; keep cookies for the next attempt.
  | { status: "error"; error: Error };

const persistRollingCookies = async (
  storedCookies: string,
  responseHeaders: Record<string, unknown> | undefined,
) => {
  const normalizedCookies = normalizeSetCookieHeader(
    responseHeaders?.["set-cookie"],
  );
  if (!normalizedCookies) {
    return;
  }
  const incomingSetCookie = normalizedCookies
    .split(/,(?=[^;]+?=)/)
    .map((cookie) => cookie.trim())
    .filter(Boolean);
  const cookieHeaderValue = mergeCookieHeaders(storedCookies, incomingSetCookie);
  if (cookieHeaderValue) {
    await saveData("sessionCookies", cookieHeaderValue);
  }
};

const fetchSession = async (): Promise<SessionOutcome> => {
  const storedCookies = await getData("sessionCookies");
  if (!storedCookies) {
    debugLog("fetchSession -> no-session (no cookies in storage)");
    return { status: "no-session" };
  }
  debugLog("fetchSession: sending cookies:", cookieNames(storedCookies));

  try {
    const axios = getAuthAxios();
    const sessionResponse = await axios.get("/api/auth/session", {
      headers: { Cookie: storedCookies },
      withCredentials: true,
    });

    await persistRollingCookies(storedCookies, sessionResponse.headers);

    if (hasValidSession(sessionResponse.data)) {
      debugLog("fetchSession -> authenticated");
      await saveSessionSnapshot(sessionResponse.data);
      return { status: "authenticated", data: sessionResponse.data };
    }
    debugLog(
      "fetchSession -> transient (HTTP",
      sessionResponse.status,
      "but no user)",
    );
    return { status: "transient" };
  } catch (error: any) {
    const responseStatus = error?.response?.status;
    if (responseStatus === 401 || responseStatus === 403) {
      debugLog(`fetchSession -> unauthorized (HTTP ${responseStatus})`);
      return { status: "unauthorized" };
    }
    debugLog(
      `fetchSession -> error (HTTP ${responseStatus ?? "none"}):`,
      error?.message,
    );
    return {
      status: "error",
      error: new Error(error?.response?.data?.error || error.message),
    };
  }
};

// Retry backoff (ms) for the retryable outcomes (transient / network error).
// The window is generous because a user who still holds cookies almost
// certainly has a real session — the backend just hasn't returned it yet. We
// keep the controller on `loading` (splash) for the whole window so the login
// screen is never shown to a logged-in user. A genuinely logged-out user has
// no cookies (`no-session`) and resolves instantly with no delay.
const SESSION_RETRY_DELAYS = [400, 700, 1100, 1600, 2200];

const resolveSession = async (
  retryDelays: number[] = SESSION_RETRY_DELAYS,
): Promise<SessionOutcome> => {
  let outcome = await fetchSession();
  for (
    let attempt = 0;
    (outcome.status === "transient" || outcome.status === "error") &&
    attempt < retryDelays.length;
    attempt += 1
  ) {
    debugLog(
      `resolveSession: "${outcome.status}", retry ${attempt + 1}/${
        retryDelays.length
      } in ${retryDelays[attempt]}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
    outcome = await fetchSession();
  }
  debugLog(`resolveSession: FINAL -> "${outcome.status}"`);
  return outcome;
};

export const SessionProvider: React.FC<SessionProviderProps> = ({
  children,
  baseURL,
}) => {
  const [data, setData] = useState<unknown>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  useMemo(() => {
    if (baseURL) {
      configureAuthBaseURL(baseURL);
    }
  }, [baseURL]);

  useEffect(() => {
    let cancelled = false;

    // Optimistic hydration: a returning user (cookies + a cached session) is
    // shown home INSTANTLY from the snapshot, then we re-validate against the
    // backend in the background. The login screen is only ever shown on a
    // definitive logout — never for a backend cold-start / transient blip.
    const hydrateSession = async () => {
      const [storedCookies, snapshot] = await Promise.all([
        getData("sessionCookies"),
        getSessionSnapshot(),
      ]);

      const isOptimistic = Boolean(storedCookies) && hasValidSession(snapshot);
      if (isOptimistic) {
        debugLog("hydrate: optimistic authenticated from cached snapshot");
        setData(snapshot);
        setStatus("authenticated");
      }

      const outcome = await resolveSession();
      if (cancelled) {
        return;
      }

      if (outcome.status === "authenticated") {
        // Refresh with the freshly validated session.
        setData(outcome.data);
        setStatus("authenticated");
        return;
      }

      if (outcome.status === "unauthorized") {
        // Definitively logged out — wipe everything and show login.
        await clearSession();
        setData(null);
        setStatus("unauthenticated");
        return;
      }

      // transient / network error / no-session after retries.
      if (isOptimistic) {
        // A backend hiccup must not log a returning user out — keep showing the
        // cached session; the next request / launch will re-validate.
        debugLog(`hydrate: validation "${outcome.status}", keeping cached session`);
        return;
      }

      // No cached session to fall back on (genuinely logged out, or first
      // launch after this update) — commit unauthenticated.
      setData(null);
      setStatus("unauthenticated");
    };

    hydrateSession();

    const handleSignIn = (sessionData: unknown) => {
      setData(sessionData);
      setStatus("authenticated");
    };

    const handleSignOut = async () => {
      try {
        setData(null);
        await clearSession();
        setStatus("unauthenticated");
      } catch (error) {
        console.error("Error signing out:", error);
      }
    };

    const handleSessionUpdate = (sessionData: unknown) => {
      if (hasValidSession(sessionData)) {
        setData(sessionData);
        setStatus("authenticated");
        return;
      }
      setData(null);
      setStatus("unauthenticated");
    };

    addAuthEventListener("signIn", handleSignIn);
    addAuthEventListener("signOut", handleSignOut);
    addAuthEventListener("sessionUpdate", handleSessionUpdate);

    return () => {
      cancelled = true;
      removeAuthEventListener("signIn", handleSignIn);
      removeAuthEventListener("signOut", handleSignOut);
      removeAuthEventListener("sessionUpdate", handleSessionUpdate);
    };
  }, []);

  useEffect(() => {
    debugLog(`status="${status}" (hasUser=${hasValidSession(data)})`);
  }, [status, data]);

  return (
    <SessionContext.Provider value={{ data, status }}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
};

// Retry backoff (ms) for a transient sign-in handshake failure — a 5xx "server
// configuration" error from a cold backend, a network blip, or a session that
// isn't ready yet. A genuine bad-credentials rejection is NOT retried.
const SIGNIN_HANDSHAKE_RETRIES = [700, 1600];
// Shorter session-resolve window inside the handshake (the handshake itself
// retries), so a failed sign-in can't stack into a very long wait.
const SIGNIN_RESOLVE_DELAYS = [400, 900, 1500];

type SignInResult =
  | { status: "authenticated"; data: unknown }
  // transient (cold backend / network / session not ready) — retry handshake.
  | { status: "retriable"; message: string }
  // bad credentials / unauthorized — surface immediately, do not retry.
  | { status: "rejected"; message: string };

// Returns true when an error string clearly indicates rejected credentials
// (so we fail fast instead of retrying a wrong password).
const isCredentialRejection = (message: string) =>
  /credential|signin|password|invalid|incorrect|no user|not found/i.test(
    message,
  );

const performSignInHandshake = async (
  options: Record<string, unknown>,
): Promise<SignInResult> => {
  const axios = getAuthAxios();

  // --- Step 1: fetch CSRF token -----------------------------------------
  let csrfResponse: any;
  try {
    debugLog("signIn[1/4]: GET /api/auth/csrf ...");
    csrfResponse = await axios.get("/api/auth/csrf", {
      headers: { "x-skip-auth-cookie": "true" },
      withCredentials: true,
    });
  } catch (error: any) {
    const httpStatus = error?.response?.status;
    debugLog("signIn[1/4]: ❌ csrf failed http=", httpStatus ?? "none", error?.message);
    return { status: "retriable", message: error?.message || "CSRF request failed" };
  }

  const csrfToken = csrfResponse.data?.csrfToken;
  const initialCookies = csrfResponse.headers["set-cookie"];
  debugLog(
    "signIn[1/4]: csrf -> http=",
    csrfResponse.status,
    "csrfToken=",
    csrfToken ? `present(len ${String(csrfToken).length})` : "MISSING",
    "set-cookie=",
    setCookieNames(initialCookies),
  );
  if (!csrfToken) {
    return { status: "retriable", message: "CSRF token missing" };
  }
  if (!initialCookies) {
    // Not fatal on iOS: the native cookie store may still hold the csrf cookie.
    debugLog(
      "signIn[1/4]: ⚠️ no set-cookie on csrf (iOS native cookie store may still carry it)",
    );
  }

  const credentials = {
    ...options,
    csrfToken,
    callbackUrl: "/",
    redirect: false,
    json: true,
  };

  // --- Step 2: post credentials to the callback -------------------------
  let callbackResponse: any = null;
  try {
    const callbackData = new URLSearchParams();
    Object.entries(credentials).forEach(([key, value]) => {
      callbackData.append(key, String(value));
    });

    debugLog(
      "signIn[2/4]: POST /api/auth/callback/credentials ... sending cookie names=",
      setCookieNames(initialCookies),
    );
    callbackResponse = await axios.post(
      "/api/auth/callback/credentials",
      callbackData.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-skip-auth-cookie": "true",
          Cookie: initialCookies ? initialCookies.join("; ") : "",
        },
        withCredentials: true,
        maxRedirects: 0,
      },
    );
    debugLog(
      "signIn[2/4]: callback -> http=",
      callbackResponse.status,
      "set-cookie=",
      setCookieNames(callbackResponse.headers["set-cookie"]),
      "body=",
      callbackResponse.data,
    );
  } catch (error: any) {
    const httpStatus = error?.response?.status;
    const failUrl = error?.response?.data?.url;
    const parsedError = failUrl
      ? decodeURIComponent(failUrl.split("error=")?.[1] ?? "")
      : "";
    const serverMessage = error?.response?.data?.message || error?.message;
    debugLog(
      "signIn[2/4]: ❌ callback threw — http=",
      httpStatus ?? "none",
      "url=",
      failUrl ?? "n/a",
      "parsedError=",
      parsedError || "(none)",
      "data=",
      error?.response?.data ?? error?.message,
    );
    // Clear credential rejection -> fail fast.
    if (parsedError && isCredentialRejection(parsedError)) {
      return { status: "rejected", message: parsedError };
    }
    // 5xx (cold-start "server configuration"), network (no status), and
    // 4xx CSRF-cookie races are all transient on iOS -> retry the handshake.
    return {
      status: "retriable",
      message: parsedError || serverMessage || `callback failed (${httpStatus ?? "network"})`,
    };
  }

  // A 200 response can still carry a credential error in its `url`.
  const callbackUrl: string | undefined = callbackResponse?.data?.url;
  if (callbackUrl && callbackUrl.includes("error=")) {
    const parsedError = decodeURIComponent(
      callbackUrl.split("error=")?.[1] ?? "Auth failed",
    );
    debugLog("signIn[2/4]: ❌ callback url carries error=", parsedError);
    return isCredentialRejection(parsedError)
      ? { status: "rejected", message: parsedError }
      : { status: "retriable", message: parsedError };
  }

  // --- Step 3: merge + persist session cookies --------------------------
  let sessionCookies = initialCookies ? [...initialCookies] : [];
  const callbackCookies = callbackResponse?.headers["set-cookie"];
  if (Array.isArray(callbackCookies)) {
    sessionCookies = [...sessionCookies, ...callbackCookies];
  } else if (typeof callbackCookies === "string" && callbackCookies.trim()) {
    sessionCookies = [...sessionCookies, callbackCookies];
  }

  const cookieHeaderValue = mergeCookieHeaders(null, sessionCookies);
  debugLog(
    "signIn[3/4]: merged cookies ->",
    cookieHeaderValue ? cookieNames(cookieHeaderValue) : "NONE",
  );
  if (cookieHeaderValue) {
    const hasSessionToken = cookieNames(cookieHeaderValue).some((n) =>
      n.includes("next-auth.session-token"),
    );
    if (!hasSessionToken) {
      // Not fatal on iOS — the native cookie store carries the HttpOnly token.
      debugLog(
        "signIn[3/4]: ⚠️ no next-auth.session-token in JS cookies — relying on iOS native cookie store",
      );
    }
    await saveData("sessionCookies", cookieHeaderValue);
  } else {
    debugLog(
      "signIn[3/4]: no JS cookies to persist — relying on native cookie store",
    );
  }

  // --- Step 4: resolve the session (retries the transient 200-no-user) ---
  debugLog("signIn[4/4]: resolving session...");
  const outcome = await resolveSession(SIGNIN_RESOLVE_DELAYS);
  debugLog("signIn[4/4]: resolveSession ->", outcome.status);
  if (outcome.status === "authenticated") {
    return { status: "authenticated", data: outcome.data };
  }
  if (outcome.status === "unauthorized") {
    return { status: "rejected", message: "Unauthorized session" };
  }
  // transient / network error / no-session: backend hasn't surfaced the session
  // yet (cold start) -> retry the whole handshake.
  return { status: "retriable", message: `session not ready (${outcome.status})` };
};

export const signIn = async (options: Record<string, unknown>) => {
  debugLog("==================== signIn START ====================");
  debugLog("signIn: option keys:", Object.keys(options));

  const maxAttempts = SIGNIN_HANDSHAKE_RETRIES.length + 1;
  let lastMessage = "Auth failed";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const delay = SIGNIN_HANDSHAKE_RETRIES[attempt - 1];
      debugLog(
        `signIn: transient failure — retry ${attempt + 1}/${maxAttempts} in ${delay}ms (last: ${lastMessage})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    let result: SignInResult;
    try {
      result = await performSignInHandshake(options);
    } catch (error: any) {
      // Unexpected/unclassified error — treat as transient and retry.
      lastMessage = error?.message || "Auth failed";
      debugLog("signIn: unexpected error:", lastMessage);
      result = { status: "retriable", message: lastMessage };
    }

    if (result.status === "authenticated") {
      debugLog("==================== signIn SUCCESS ====================");
      emitAuthEvent("signIn", result.data);
      return result.data;
    }

    if (result.status === "rejected") {
      await clearSession();
      debugLog(
        `==================== signIn REJECTED: ${result.message} ====================`,
      );
      throw new Error(result.message || "Auth failed");
    }

    lastMessage = result.message;
  }

  debugLog(
    `==================== signIn FAILED after ${maxAttempts} attempts: ${lastMessage} ====================`,
  );
  throw new Error(lastMessage || "Auth failed");
};

export const signOut = async (onSignOut?: () => void) => {
  try {
    await clearSession();
    emitAuthEvent("signOut");
    onSignOut?.();
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
};

// Public manual-refresh entry point. Retries the transient window so callers
// get the settled session, and only emits `sessionUpdate(null)` (which flips
// consumers to unauthenticated) on a *definitive* logged-out outcome.
export const update = async () => {
  const outcome = await resolveSession();

  if (outcome.status === "authenticated") {
    emitAuthEvent("sessionUpdate", outcome.data);
    return outcome.data;
  }

  if (outcome.status === "unauthorized") {
    await clearSession();
    emitAuthEvent("sessionUpdate", null);
    throw new Error("Unauthorized session");
  }

  if (outcome.status === "no-session") {
    emitAuthEvent("sessionUpdate", null);
    throw new Error("No session found");
  }

  // transient / network error after retries: surface a retryable error WITHOUT
  // emitting unauth, so a transient blip never logs the user out.
  throw new Error(
    outcome.status === "transient"
      ? "Session is missing user data"
      : outcome.error.message,
  );
};
