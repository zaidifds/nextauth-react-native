// src/next-auth.tsx
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo
} from "react";

// src/axiosHelper.ts
import axiosBase from "axios";

// src/storageHelper.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
var saveData = async (key, value) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error("Error saving data:", error);
  }
};
var getData = async (key) => {
  try {
    const value = await AsyncStorage.getItem(key);
    if (value !== null) {
      return JSON.parse(value);
    }
    return null;
  } catch (error) {
    console.error("Error retrieving data:", error);
    return null;
  }
};
var removeData = async (key) => {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.error("Error removing data:", error);
  }
};

// src/axiosHelper.ts
var DEFAULT_BASE_URL = "https://example.com/";
var attachAuthInterceptors = (instance) => {
  instance.interceptors.request.use(
    async (config) => {
      const cookies = await getData("sessionCookies");
      config.headers = config.headers ?? {};
      config.headers["Cookie"] = cookies;
      return config;
    },
    (error) => Promise.reject(error)
  );
  instance.interceptors.response.use((response) => response);
  return instance;
};
var createAuthAxios = (baseURL = DEFAULT_BASE_URL) => {
  const instance = axiosBase.create({
    baseURL,
    headers: {
      "Content-Type": "application/json"
    }
  });
  return attachAuthInterceptors(instance);
};
var authBaseURL = DEFAULT_BASE_URL;
var authAxios = createAuthAxios(authBaseURL);
var configureAuthBaseURL = (baseURL) => {
  const normalizedBaseURL = baseURL?.trim();
  if (!normalizedBaseURL) {
    throw new Error("SessionProvider baseURL must be a non-empty string.");
  }
  authBaseURL = normalizedBaseURL;
  authAxios.defaults.baseURL = normalizedBaseURL;
};
var getAuthBaseURL = () => authBaseURL;
var getAuthAxios = () => authAxios;
var axiosHelper_default = authAxios;

// src/next-auth.tsx
import { jsx } from "react/jsx-runtime";
var authEventListeners = {};
var emitAuthEvent = (event, data) => {
  if (authEventListeners[event]) {
    authEventListeners[event].forEach((listener) => listener(data));
  }
};
var addAuthEventListener = (event, listener) => {
  if (!authEventListeners[event]) {
    authEventListeners[event] = [];
  }
  authEventListeners[event].push(listener);
};
var removeAuthEventListener = (event, listener) => {
  if (authEventListeners[event]) {
    authEventListeners[event] = authEventListeners[event].filter(
      (l) => l !== listener
    );
  }
};
var SessionContext = createContext(
  void 0
);
var SessionProvider = ({
  children,
  baseURL
}) => {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  useMemo(() => {
    if (baseURL) {
      configureAuthBaseURL(baseURL);
    }
  }, [baseURL]);
  useEffect(() => {
    update().then((res) => {
      setData(res);
      setStatus("authenticated");
    }).catch(() => {
      setData(null);
      setStatus("unauthenticated");
    });
    const handleSignIn = (sessionData) => {
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
    const handleSessionUpdate = (sessionData) => {
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
  return /* @__PURE__ */ jsx(
    SessionContext.Provider,
    {
      value: {
        data,
        status
      },
      children
    }
  );
};
var useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
};
var signIn = async (options) => {
  try {
    const axios = getAuthAxios();
    const csrfResponse = await axios.get("/api/auth/csrf", {
      withCredentials: true
    });
    const csrfToken = csrfResponse.data.csrfToken;
    const initialCookies = csrfResponse.headers["set-cookie"];
    const credentials = {
      ...options,
      csrfToken,
      callbackUrl: "/",
      redirect: false,
      json: true
    };
    let callbackResponse = null;
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
            Cookie: initialCookies ? initialCookies.join("; ") : ""
          },
          withCredentials: true,
          maxRedirects: 0
        }
      );
    } catch (error) {
      throw new Error(
        decodeURIComponent(error?.response?.data?.url?.split("error=")?.[1] ?? "Auth failed")
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
  } catch (error) {
    throw new Error(error.message);
  }
};
var signOut = async (onSignOut) => {
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
var update = async () => {
  try {
    const axios = getAuthAxios();
    const storedCookies = await getData("sessionCookies");
    if (!storedCookies) {
      throw new Error("No session found");
    }
    const sessionResponse = await axios.get("/api/auth/session", {
      headers: {
        Cookie: storedCookies
      },
      withCredentials: true
    });
    if (sessionResponse.headers["set-cookie"]) {
      await saveData(
        "sessionCookies",
        sessionResponse.headers["set-cookie"].join("; ")
      );
    }
    emitAuthEvent("sessionUpdate", sessionResponse.data);
    return sessionResponse.data;
  } catch (error) {
    await removeData("sessionCookies");
    emitAuthEvent("sessionUpdate", null);
    throw new Error(error?.response?.data?.error || error.message);
  }
};
export {
  SessionContext,
  SessionProvider,
  axiosHelper_default as axios,
  createAuthAxios,
  getAuthAxios,
  getAuthBaseURL,
  getData,
  removeData,
  saveData,
  signIn,
  signOut,
  update,
  useSession
};
//# sourceMappingURL=index.js.map