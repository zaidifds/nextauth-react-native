# nextauth-react-native

NextAuth helpers for React Native.

This package is built to replicate a NextAuth flow in mobile apps and is compatible with **NextAuth Pages Router** and **App Router** projects.

## Install

```bash
npm i nextauth-react-native
```

## Compatibility

- Supports NextAuth endpoints from **Pages Router** (`pages/api/auth/[...nextauth].ts`)
- Supports NextAuth endpoints from **App Router** (`app/api/auth/[...nextauth]/route.ts`)

## Quick Start

No setup command or generated helper files are required.

Wrap your app with `SessionProvider` and pass your backend base URL:

```tsx
import React from "react";
import { SessionProvider } from "nextauth-react-native";
import MainNavigator from "./src/MainNavigator";

export default function App() {
  return (
    <SessionProvider baseURL="https://your-nextjs-domain.com">
      <MainNavigator />
    </SessionProvider>
  );
}
```

Package auth methods (`signIn`, `useSession`, `update`) use the `baseURL` from `SessionProvider`.
Session cookies are stored internally by the package.

Your Next.js backend must expose standard NextAuth routes like:

- `GET /api/auth/csrf`
- `POST /api/auth/callback/credentials`
- `GET /api/auth/session`

## Exports

```ts
import {
  SessionProvider,
  useSession,
  signIn,
  signOut,
  update,
  axios,
} from "nextauth-react-native";
```

`update()` fetches the latest session from your NextAuth backend and also updates `useSession` state in `SessionProvider`.

## Using `signIn`, `useSession`, and `signOut`

```tsx
import React, { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { signIn, signOut, useSession } from "nextauth-react-native";

export default function AuthScreen() {
  const { data: session, status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onLogin = async () => {
    try {
      await signIn({ email, password });
    } catch (error: any) {
      console.log("Login failed:", error.message);
    }
  };

  const onLogout = async () => {
    await signOut();
  };

  return (
    <View style={{ padding: 16 }}>
      <Text>Status: {status}</Text>
      {status === "authenticated" ? (
        <>
          <Text>Welcome {String((session as any)?.user?.name ?? "")}</Text>
          <Button title="Sign Out" onPress={onLogout} />
        </>
      ) : (
        <>
          <TextInput
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Button title="Sign In" onPress={onLogin} />
        </>
      )}
    </View>
  );
}
```
