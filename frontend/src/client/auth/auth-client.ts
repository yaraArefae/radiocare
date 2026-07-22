import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

import { ac, roles } from "@/shared/auth/permissions";

const authBaseUrl =
  typeof window !== "undefined"
    ? new URL("/api/auth", window.location.origin).toString()
    : process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "";

export const authClient = createAuthClient({
  baseURL: authBaseUrl,

  plugins: [
    adminClient({
      ac,
      roles,
    }),
  ],
});

export const {
  signIn,
  signOut,
  signUp,
  useSession,
} = authClient;
