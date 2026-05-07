import axiosBase, { AxiosInstance } from "axios";
import { getData } from "./storageHelper";

const DEFAULT_BASE_URL = "https://example.com/";

const attachAuthInterceptors = (instance: AxiosInstance) => {
  instance.interceptors.request.use(
    async (config) => {
      const cookies = await getData("sessionCookies");
      config.headers = config.headers ?? ({} as any);
      (config.headers as any)["Cookie"] = cookies;
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
