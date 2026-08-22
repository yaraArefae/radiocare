import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

/*
  Every call the application makes to RadioCare.

  The mobile application talks to the same backend as the website and
  owns no data of its own: the same accounts, the same studies, the same
  AI service. Anything it can do, the website can already do, which is
  what keeps the two from drifting apart.
*/

/*
  Where the backend lives.

  On a phone, "localhost" is the phone itself, so the address has to be
  the laptop on the shared network. Expo already knows that address -
  it is the host serving the bundle - so it is reused rather than typed
  in by hand and forgotten.
*/
function resolveBackendUrl() {
  const configured = process.env.EXPO_PUBLIC_BACKEND_URL;

  if (configured) return configured.replace(/\/$/, "");

  if (Platform.OS === "web") return "http://localhost:4000";

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)
      ?.debuggerHost;

  const host = hostUri?.split(":")[0];

  return host ? `http://${host}:4000` : "http://localhost:4000";
}

export const backendUrl = resolveBackendUrl();

export const aiServiceUrl = (
  process.env.EXPO_PUBLIC_AI_SERVICE_URL ??
  backendUrl.replace(":4000", ":8001")
).replace(/\/$/, "");

const SESSION_KEY = "radiocare.session.cookie";
const TOKEN_KEY = "radiocare.session.token";

/*
  The session, carried as a bearer token.

  A browser stores the session cookie and returns it on its own. A phone
  cannot: iOS keeps cookies inside its networking layer and ignores a
  Cookie header the application sets by hand, so the session was created
  and then never presented again. The server therefore also accepts the
  same session as an Authorization header, which nothing intercepts, and
  that is what the phone uses.
*/
let sessionToken: string | null = null;

export async function loadStoredToken() {
  if (sessionToken) return sessionToken;

  sessionToken = await AsyncStorage.getItem(TOKEN_KEY);

  return sessionToken;
}

export async function storeToken(token: string | null) {
  sessionToken = token;

  if (token) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
}

/*
  What the application calls itself when it asks the server for a
  session.

  The sign-in endpoint refuses a request that carries no Origin, which
  is what a native app sends by default: the header exists to stop
  another website from signing a user in behind their back, and "no
  origin" cannot be checked. So the app declares its own scheme - the
  one registered in app.json - and the server lists it as trusted.

  In a browser the header is set by the browser and cannot be
  overwritten, so this is only ever used on a phone.
*/
const APP_ORIGIN = "radiocare://";

function withOrigin(headers: Record<string, string>) {
  if (Platform.OS !== "web") headers.Origin = APP_ORIGIN;

  return headers;
}

/*
  The session.

  The website keeps it in a cookie the browser stores on its own. A
  React Native app has no cookie jar it can rely on across platforms, so
  the cookie the server sets at sign in is kept here and sent back by
  hand on every later call. It is the same session the website uses;
  only the storage differs.
*/
let sessionCookie: string | null = null;

export async function loadStoredSession() {
  if (sessionCookie) return sessionCookie;

  sessionCookie = await AsyncStorage.getItem(SESSION_KEY);

  return sessionCookie;
}

export async function storeSession(cookie: string | null) {
  sessionCookie = cookie;

  if (cookie) {
    await AsyncStorage.setItem(SESSION_KEY, cookie);
  } else {
    await AsyncStorage.removeItem(SESSION_KEY);
  }
}

/*
  A Set-Cookie header carries attributes the server needs and the client
  must not send back. Only the name and value are kept.
*/
function readSessionCookie(response: Response) {
  /*
    Every way a runtime exposes Set-Cookie.

    A browser hides the header entirely and stores the cookie itself; a
    phone gives it back under a name and a shape that differ between
    platforms and versions. All of them are tried, and if none has it
    the native cookie store is trusted to send it back on its own.
  */
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
    map?: Record<string, string>;
  };

  const raw =
    (typeof headers.getSetCookie === "function"
      ? headers.getSetCookie().join(", ")
      : null) ||
    response.headers.get("set-cookie") ||
    response.headers.get("Set-Cookie") ||
    headers.map?.["set-cookie"] ||
    null;

  if (!raw) return null;

  const pairs = raw
    .split(/,(?=[^;]+?=)/)
    .map((part) => part.split(";")[0].trim())
    .filter((part) => part.includes("="));

  const session = pairs.find((pair) =>
    pair.startsWith("better-auth.session_token"),
  );

  return session ?? pairs[0] ?? null;
}

export type ApiResult<T> = {
  ok: boolean;
  status: number;
  data: T;
};

export async function api<T = any>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    formData?: FormData;
    baseUrl?: string;
  } = {},
): Promise<ApiResult<T>> {
  const cookie = await loadStoredSession();
  const token = await loadStoredToken();

  const headers: Record<string, string> = {};

  /*
    Both are offered. The browser build ignores the header it does not
    need, and the phone relies on the token.
  */
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(
    `${options.baseUrl ?? backendUrl}${path}`,
    {
      method: options.method ?? (options.body || options.formData ? "POST" : "GET"),
      headers: withOrigin(headers),
      body: options.formData ?? (options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined),
      /* The web build runs in a browser, where the cookie is the browser's. */
      credentials: "include",
    },
  );

  const fresh = readSessionCookie(response);

  if (fresh) await storeSession(fresh);

  let data: any = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { ok: response.ok, status: response.status, data };
}

export async function signIn(email: string, password: string) {
  const response = await fetch(`${backendUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: withOrigin({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false,
      message: data?.message ?? "Wrong email or password.",
      user: null,
    };
  }

  const cookie = readSessionCookie(response);

  if (cookie) await storeSession(cookie);

  /*
    The token comes back in the body of the sign-in reply, and also in a
    header when the bearer plugin is enabled. Either is the session.
  */
  const token =
    response.headers.get("set-auth-token") ??
    (typeof data?.token === "string" ? data.token : null);

  if (token) await storeToken(token);

  return { ok: true, message: "", user: data?.user ?? null };
}

export async function signOut() {
  try {
    await api("/api/auth/sign-out", { method: "POST", body: {} });
  } finally {
    await storeSession(null);
    await storeToken(null);
  }
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role?: string;
};

/*
  Who is signed in, or null when nobody is.

  A failure to reach the server is not the same as being signed out, so
  it is reported separately: a screen that treats a dropped connection
  as a sign-out throws the user back to the login form every time the
  network hiccups.
*/
export async function currentSession(): Promise<SessionUser | null> {
  const result = await api<{ user?: SessionUser }>("/api/auth/get-session");

  if (!result.ok) return null;

  return result.data?.user ?? null;
}

/*
  Everything the sign-in screen needs to explain a failure instead of
  bouncing the user back to an empty form: whether the session was
  accepted, and if not, what the server actually said.
*/
export async function describeSession() {
  const cookie = await loadStoredSession();
  const token = await loadStoredToken();

  const result = await api<{ user?: SessionUser; message?: string }>(
    "/api/auth/get-session",
  );

  return {
    user: result.data?.user ?? null,
    status: result.status,
    hasCookie: Boolean(cookie),
    hasToken: Boolean(token),
    message: result.data?.message ?? "",
  };
}

export function rolesOf(role: unknown) {
  return (Array.isArray(role) ? role : String(role ?? "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}
