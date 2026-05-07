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
    update()
      .then((res) => {
        setData(res);
        setStatus("authenticated");
      })
      .catch(() => {
        setData(null);
        setStatus("unauthenticated");
      });

    const handleSignIn = (sessionData: unknown) => {
      setData(sessionData);
      setStatus("authenticated");
    };

    const handleSignOut = async () => {
      try {
        setData(null);
        await removeData("sessionCookies");
        setStatus("unauthenticated");
      } catch (error) {
        console.error("Error signing out:", error);
      }
    };

    const handleSessionUpdate = (sessionData: unknown) => {
      if (sessionData) {
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
      sessionCookies = [...sessionCookies, ...callbackCookies];
    }

    await saveData("sessionCookies", sessionCookies.join("; "));
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
    if (!storedCookies) {
      throw new Error("No session found");
    }

    const sessionResponse = await axios.get("/api/auth/session", {
      headers: {
        Cookie: storedCookies,
      },
      withCredentials: true,
    });

    if (sessionResponse.headers["set-cookie"]) {
      await saveData(
        "sessionCookies",
        sessionResponse.headers["set-cookie"].join("; "),
      );
    }

    emitAuthEvent("sessionUpdate", sessionResponse.data);
    return sessionResponse.data;
  } catch (error: any) {
    await removeData("sessionCookies");
    emitAuthEvent("sessionUpdate", null);
    throw new Error(error?.response?.data?.error || error.message);
  }
};
