import { NextRequest, NextResponse } from "next/server";

/*
  The website runs on 3000. The mobile application, when it is opened on
  a laptop instead of a phone, is served by Expo on 8081 - and a phone
  running it natively sends no origin at all, so it never reaches this
  list. Adding the Expo port lets the two be developed side by side
  without changing anything the website relies on.
*/
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  /* Expo moves to the next free port when 8081 is taken. */
  "http://localhost:8082",
  "http://127.0.0.1:8082",
  "http://localhost:8090",
  "http://127.0.0.1:8090",
];

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, {
      status: 204,
    });

    if (origin && allowedOrigins.includes(origin)) {
      response.headers.set(
        "Access-Control-Allow-Origin",
        origin,
      );

      response.headers.set(
        "Access-Control-Allow-Credentials",
        "true",
      );
    }

    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );

    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    return response;
  }

  const response = NextResponse.next();

  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set(
      "Access-Control-Allow-Origin",
      origin,
    );

    response.headers.set(
      "Access-Control-Allow-Credentials",
      "true",
    );
  }

  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );

  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );

  return response;
}

export const config = {
  matcher: "/api/:path*",
};