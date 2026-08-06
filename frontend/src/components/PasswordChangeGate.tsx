"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

/*
  Sends an account that is still on the temporary password an
  administrator issued to the change password screen.

  Without this the temporary password worked for ever: the approval flow
  recorded an expiry date that nothing ever read.
*/
export default function PasswordChangeGate() {
  const router = useRouter();

  useEffect(() => {
    let isActive = true;

    async function checkPassword() {
      try {
        const response = await fetch(
          `${backendBaseUrl}/api/account/password-status`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          },
        );

        if (!response.ok) return;

        const data = await response.json();

        if (isActive && data.success && data.mustChangePassword) {
          router.replace("/change-password?required=1");
        }
      } catch (error) {
        console.error("Unable to check the password status:", error);
      }
    }

    void checkPassword();

    return () => {
      isActive = false;
    };
  }, [router]);

  return null;
}
