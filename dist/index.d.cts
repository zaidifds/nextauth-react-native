import React, { ReactNode } from 'react';
import { AxiosInstance } from 'axios';

type SessionContextType = {
    data: unknown;
    status: "loading" | "authenticated" | "unauthenticated";
};
declare const SessionContext: React.Context<SessionContextType | undefined>;
type SessionProviderProps = {
    children: ReactNode;
    baseURL?: string;
};
declare const SessionProvider: React.FC<SessionProviderProps>;
declare const useSession: () => SessionContextType;
declare const signIn: (options: Record<string, unknown>) => Promise<any>;
declare const signOut: (onSignOut?: () => void) => Promise<void>;
declare const update: () => Promise<any>;

declare const createAuthAxios: (baseURL?: string) => AxiosInstance;
declare const authAxios: AxiosInstance;
declare const getAuthBaseURL: () => string;
declare const getAuthAxios: () => AxiosInstance;

declare const saveData: (key: string, value: unknown) => Promise<void>;
declare const getData: (key: string) => Promise<any>;
declare const removeData: (key: string) => Promise<void>;

export { SessionContext, SessionProvider, authAxios as axios, createAuthAxios, getAuthAxios, getAuthBaseURL, getData, removeData, saveData, signIn, signOut, update, useSession };
