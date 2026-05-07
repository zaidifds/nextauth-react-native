import axiosBase, { AxiosInstance } from "axios";
import { getData } from "./storageHelper";

const DEFAULT_BASE_URL = "https://example.com/";

const attachAuthInterceptors = (instance: AxiosInstance) => {
  instance.interceptors.request.use(
    async (config) => {
      const skipAuthCookieInjection = Boolean(
        (config.headers as any)?.["x-skip-auth-cookie"],
      );
      if (skipAuthCookieInjection) {
        const headers = config.headers as any;
        if (typeof headers?.delete === "function") {
          headers.delete("x-skip-auth-cookie");
        } else if (headers) {
          delete headers["x-skip-auth-cookie"];
        }
        return config;
      }

      const cookies = await getData("sessionCookies");
      config.headers = config.headers ?? ({} as any);
      if (cookies) {
        const headers = config.headers as any;
        if (typeof headers.set === "function") {
          headers.set("Cookie", cookies);
        } else {
          headers.Cookie = cookies;
        }
      }
      console.log("[sessionCookies] axios request url:", config.url);
      console.log("[sessionCookies] axios request has cookies:", Boolean(cookies));
      return config;
    },
    (error) => Promise.reject(error),
  );

  instance.interceptors.response.use((response) => response);

  return instance;
};

export const createAuthAxios = (baseURL = DEFAULT_BASE_URL) => {
  const instance = axiosBase.create({
    baseURL,
    withCredentials: true,
    headers: {
      "Content-Type": "application/json",
    },
  });

  return attachAuthInterceptors(instance);
};

let authBaseURL = DEFAULT_BASE_URL;
const authAxios = createAuthAxios(authBaseURL);

export const configureAuthBaseURL = (baseURL: string) => {
  const normalizedBaseURL = baseURL?.trim();
  if (!normalizedBaseURL) {
    throw new Error("SessionProvider baseURL must be a non-empty string.");
  }
  authBaseURL = normalizedBaseURL;
  authAxios.defaults.baseURL = normalizedBaseURL;
};

export const getAuthBaseURL = () => authBaseURL;
export const getAuthAxios = () => authAxios;

export default authAxios;