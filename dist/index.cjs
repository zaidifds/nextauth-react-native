"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  SessionContext: () => SessionContext,
  SessionProvider: () => SessionProvider,
  axios: () => axiosHelper_default,
  createAuthAxios: () => createAuthAxios,
  getAuthAxios: () => getAuthAxios,
  getAuthBaseURL: () => getAuthBaseURL,
  getData: () => getData,
  removeData: () => removeData,
  saveData: () => saveData,
  signIn: () => signIn,
  signOut: () => signOut,
  update: () => update,
  useSession: () => useSession
});
module.exports = __toCommonJS(index_exports);

// src/next-auth.tsx
var import_react = require("react");

// src/axiosHelper.ts
var import_axios = __toESM(require("axios"), 1);

// src/storageHelper.ts
var import_async_storage = __toESM(require("@react-native-async-storage/async-storage"), 1);
var saveData = async (key, value) => {
  try {
    await import_async_storage.default.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error("Error saving data:", error);
  }
};
var getData = async (key) => {
  try {
    const value = await import_async_storage.default.getItem(key);
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
    await import_async_storage.default.removeItem(key);
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
  const instance = import_axios.default.create({
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
var import_jsx_runtime = require("react/jsx-runtime");
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
var SessionContext = (0, import_react.createContext)(
  void 0
);
var SessionProvider = ({
  children,
  baseURL
}) => {
  const [data, setData] = (0, import_react.useState)(null);
  const [status, setStatus] = (0, import_react.useState)("loading");
  (0, import_react.useMemo)(() => {
    if (baseURL) {
      configureAuthBaseURL(baseURL);
    }
  }, [baseURL]);
  (0, import_react.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
  const context = (0, import_react.useContext)(SessionContext);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SessionContext,
  SessionProvider,
  axios,
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
});
//# sourceMappingURL=index.cjs.map