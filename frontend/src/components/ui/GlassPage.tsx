import Image from "next/image";
import type { ReactNode } from "react";

type GlassPageProps = {
  children: ReactNode;
  maxWidthClass?: string;
};

export default function GlassPage({
  children,
  maxWidthClass = "max-w-md",
}: GlassPageProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-blue-950 p-5 text-white">
      <Image
        src="/images/login-radiology.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center opacity-75"
      />

      <div className="absolute inset-0 bg-gradient-to-br from-blue-950/80 via-blue-800/65 to-cyan-800/60" />

      <div className="pointer-events-none absolute -left-32 top-10 h-96 w-96 rounded-full bg-blue-300/30 blur-[140px]" />

      <div className="pointer-events-none absolute -right-32 bottom-0 h-[430px] w-[430px] rounded-full bg-cyan-300/25 blur-[150px]" />

      <div
        className={`relative z-10 w-full ${maxWidthClass} rounded-[30px] border border-white/20 bg-white/[0.14] p-8 shadow-[0_30px_90px_rgba(0,0,0,0.4)] backdrop-blur-2xl sm:p-10`}
      >
        {children}
      </div>
    </main>
  );
}