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

type AuthEventListener = (data?: unknown) => void;
const authEventListeners: Record<string, AuthEventListener[]> = {};

const emitAuthEvent = (event: string, data?: unknown) => {
  if (authEventListeners[event]) {
    authEventListeners[event].forEach((listener) => listener(data));
  }
};

const addAuthEventListener = (event: string, listener: AuthEventListener) => {
  if (!authEventListeners[event]) {
    authEventListeners[event] = [];
  }
  authEventListeners[event].push(listener);
};

const removeAuthEventListener = (event: string, listener: AuthEventListener) => {
  if (authEventListeners[event]) {
    authEventListeners[event] = authEventListeners[event].filter(
      (l) => l !== listener,
    );
  }
};

type SessionContextType = {
  data: unknown;
  status: "loading" | "authenticated" | "unauthenticated";
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
  const cookiePairs = cookieHeaderValue
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes("="));

  cookiePairs.forEach((pair) => {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) {
      return;
    }
    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1);
    if (!key) {
      return;
    }
    cookieMap.set(key, value);
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
    const value = firstSegment.slice(separatorIndex + 1);
    if (!key) {
      return;
    }
    cookieMap.set(key, value);
  });

  return cookieMap;
};

const toCookieHeaderValue = (cookieMap: Map<string, string>) => {
  const cookieHeaderValue = Array.from(cookieMap.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");

  return cookieHeaderValue || null;
};

const mergeCookieHeaders = (existingCookies: string | null, incomingSetCookie: string[]) => {
  const existingMap = existingCookies ? parseCookiePairs(existingCookies) : new Map<string, string>();
  const incomingMap = parseSetCookieLines(incomingSetCookie);

  incomingMap.forEach((value, key) => {
    const isSessionTokenCookie = key.includes("next-auth.session-token");
    const isEmptyValue = value.trim().length === 0;

    if (isSessionTokenCookie && isEmptyValue && existingMap.get(key)) {
      // console.log(`[sessionCookies] preserve existing ${key}, incoming empty token ignored`);
      return;
    }

    existingMap.set(key, value);
  });

  return toCookieHeaderValue(existingMap);
};

const logSessionCookies = (label: string, cookieValue: unknown) => {
  // console.log(`[sessionCookies] ${label}:`, cookieValue);
};

export const SessionProvider: React.FC<SessionProviderProps> = ({
  children,
  baseURL,
}) => {
  const [data, setData] = useState<unknown>(null);
  const [status, setStatus] = useState<
    "loading" | "authenticated" | "unauthenticated"
  >("loading");

  useMemo(() => {
    if (baseURL) {
      configureAuthBaseURL(baseURL);
    }
  }, [baseURL]);

  useEffect(() => {
    const hydrateSession = async () => {
      try {
        const res = await update();
        if (hasValidSession(res)) {
          setData(res);
          setStatus("authenticated");
          return;
        }
        setData(null);
        setStatus("unauthenticated");
      } catch {
        try {
          await new Promise((resolve) => setTimeout(resolve, 800));
          const retryRes = await update();
          if (hasValidSession(retryRes)) {
            setData(retryRes);
            setStatus("authenticated");
            return;
          }
        } catch {
        }
        setData(null);
        setStatus("unauthenticated");
      }
    };

    hydrateSession();

    const handleSignIn = (sessionData: unknown) => {
      setData(sessionData);
      setStatus("authenticated");
    };

    const handleSignOut = async () => {
      try {
        setData(null);
        // console.log(
        //   "[sessionCookies] handleSignOut: removeData disabled for debugging",
        // );
        removeData("sessionCookies");
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
      removeAuthEventListener("signIn", handleSignIn);
      removeAuthEventListener("signOut", handleSignOut);
      removeAuthEventListener("sessionUpdate", handleSessionUpdate);
    };
  }, []);

  return (
    <SessionContext.Provider
      value={{
        data,
        status,
      }}
    >
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

export const signIn = async (options: Record<string, unknown>) => {
  try {
    const axios = getAuthAxios();
    const csrfResponse = await axios.get("/api/auth/csrf", {
      headers: {
        "x-skip-auth-cookie": "true",
      },
      withCredentials: true,
    });
    const csrfToken = csrfResponse.data.csrfToken;
    const initialCookies = csrfResponse.headers["set-cookie"];
    const credentials = {
      ...options,
      csrfToken,
      callbackUrl: "/",
      redirect: false,
      json: true,
    };

    let callbackResponse: any = null;

    try {
      const callbackData = new URLSearchParams();
      Object.entries(credentials).forEach(([key, value]) => {
        callbackData.append(key, String(value));
      });

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
    } catch (error: any) {
      throw new Error(
        decodeURIComponent(error?.response?.data?.url?.split("error=")?.[1] ?? "Auth failed"),
      );
    }

    let sessionCookies = initialCookies ? [...initialCookies] : [];
    if (callbackResponse && callbackResponse.headers["set-cookie"]) {
      const callbackCookies = callbackResponse.headers["set-cookie"];
      if (Array.isArray(callbackCookies)) {
        sessionCookies = [...sessionCookies, ...callbackCookies];
      } else if (typeof callbackCookies === "string" && callbackCookies.trim()) {
        sessionCookies = [...sessionCookies, callbackCookies];
      }
    }

    const cookieHeaderValue = mergeCookieHeaders(null, sessionCookies);
    if (!cookieHeaderValue) {
      throw new Error("No session cookies received");
    }
    logSessionCookies("signIn saveData payload", cookieHeaderValue);
    await saveData("sessionCookies", cookieHeaderValue);
    const sessionResponse = await update();
    if (sessionResponse) {
      emitAuthEvent("signIn", sessionResponse);
      return sessionResponse;
    }
  } catch (error: any) {
    throw new Error(error.message);
  }
};

export const signOut = async (onSignOut?: () => void) => {
  try {
    await removeData("sessionCookies");
    emitAuthEvent("signOut");
    if (onSignOut) {
      onSignOut();
    }
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
};

export const update = async () => {
  try {
    const axios = getAuthAxios();
    const storedCookies = await getData("sessionCookies");
    logSessionCookies("update getData result", storedCookies);
    if (!storedCookies) {
      throw new Error("No session found");
    }

    const sessionResponse = await axios.get("/api/auth/session", {
      headers: {
        Cookie: storedCookies,
      },
      withCredentials: true,
    });
    // console.log("[sessionCookies] /api/auth/session status:", sessionResponse.status);
    // console.log("[sessionCookies] /api/auth/session data:", sessionResponse.data);

    const normalizedCookies = normalizeSetCookieHeader(
      sessionResponse.headers["set-cookie"],
    );
    logSessionCookies("update normalized set-cookie", normalizedCookies);
    if (normalizedCookies) {
      const incomingSetCookie = normalizedCookies
        .split(/,(?=[^;]+?=)/)
        .map((cookie) => cookie.trim())
        .filter(Boolean);
      const cookieHeaderValue = mergeCookieHeaders(storedCookies, incomingSetCookie);
      if (cookieHeaderValue) {
        logSessionCookies("update saveData payload", cookieHeaderValue);
        await saveData("sessionCookies", cookieHeaderValue);
      }
    }

    if (!hasValidSession(sessionResponse.data)) {
      // console.log(
      //   "[sessionCookies] invalid session: removeData disabled for debugging",
      // );
      emitAuthEvent("sessionUpdate", null);
      throw new Error("Session is missing user data");
    }

    emitAuthEvent("sessionUpdate", sessionResponse.data);
    return sessionResponse.data;
  } catch (error: any) {
    const responseStatus = error?.response?.status;
    const isUnauthorized = responseStatus === 401 || responseStatus === 403;
    // console.log("[sessionCookies] update error status:", responseStatus);
    // console.log("[sessionCookies] update error data:", error?.response?.data);
    // console.log("[sessionCookies] update error message:", error?.message);

    if (isUnauthorized) {
      // console.log(
      //   "[sessionCookies] unauthorized: removeData disabled for debugging",
      // );
      emitAuthEvent("sessionUpdate", null);
    }

    throw new Error(error?.response?.data?.error || error.message);
  }
};