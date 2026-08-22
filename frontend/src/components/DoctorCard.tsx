"use client";

import Link from "next/link";
import { useState } from "react";

export type PublicDoctor = {
  id: string;
  name: string;
  specialty: string;
  subspecialty: string | null;
  bio: string | null;
  yearsOfExperience: number;
  languages: string[];
  consultationPrice: number | null;
  clinicNames: string[];
  rating: number | null;
  reviewCount: number;
  licenseNumber: string;
  licensingAuthority: string;
  currentWorkplace: string;
  initials: string;
  photoUrl: string | null;
};

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

/*
  The circle at the top of a card.

  Photographs are not collected from doctors yet, so the initials stand
  in for one. The colour is derived from the name rather than chosen at
  random, so the same doctor keeps the same circle on every page and a
  patient can recognise them by it.
*/
function Avatar({
  initials,
  name,
  photoUrl = null,
  size = "h-14 w-14 text-lg",
}: {
  initials: string;
  name: string;
  photoUrl?: string | null;
  size?: string;
}) {
  const palette = [
    "from-cyan-500 to-blue-600",
    "from-emerald-500 to-teal-600",
    "from-violet-500 to-purple-600",
    "from-amber-500 to-orange-600",
    "from-rose-500 to-pink-600",
  ];

  let sum = 0;

  for (const character of name) {
    sum += character.charCodeAt(0);
  }

  /*
    A photo that fails to load falls back to the initials rather than a
    broken image icon. A doctor whose file was moved or removed still
    gets a readable circle instead of a grey square.
  */
  const [photoFailed, setPhotoFailed] = useState(false);

  if (photoUrl && !photoFailed) {
    return (
      <img
        src={`${BACKEND_URL}${photoUrl}`}
        alt={name}
        onError={() => setPhotoFailed(true)}
        className={`shrink-0 rounded-full object-cover ${size}`}
      />
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${
        palette[sum % palette.length]
      } font-black text-white ${size}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

/*
  A rating is shown only once a patient has given one.

  A doctor nobody has rated is not a doctor rated zero, and drawing an
  empty star row for them would say the second thing. The count is shown
  beside the average for the same reason: 5.0 from one review and 4.6
  from ninety are not the same claim.
*/
export function Rating({
  rating,
  reviewCount,
}: {
  rating: number | null;
  reviewCount: number;
}) {
  if (rating === null) {
    return (
      <span className="rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-slate-400">
        No ratings yet
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 rounded-lg border border-amber-300/30 bg-amber-400/15 px-2.5 py-1 text-sm font-black text-amber-200">
      <span aria-hidden="true">★</span>
      {rating.toFixed(1)}
      <span className="text-xs font-bold text-amber-200/70">
        ({reviewCount})
      </span>
    </span>
  );
}

export default function DoctorCard({
  doctor,
  clinicKey,
  onChoose,
}: {
  doctor: PublicDoctor;
  clinicKey: string;
  /*
    Choosing and reading about a doctor are two different intentions, so
    they are two buttons. A card that only opened a profile would make
    every patient read three pages to pick the first name they saw.
  */
  onChoose?: () => void;
}) {
  return (
    <article className="rounded-3xl border border-white/15 bg-white/[0.07] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-2xl transition hover:border-cyan-300/40">
      <div className="flex items-start gap-4">
        <Avatar
          initials={doctor.initials}
          name={doctor.name}
          photoUrl={doctor.photoUrl}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-xl font-black text-white">
              {doctor.name}
            </h3>

            <Rating
              rating={doctor.rating}
              reviewCount={doctor.reviewCount}
            />
          </div>

          <p className="mt-1.5 inline-block rounded-lg bg-cyan-400/15 px-2.5 py-1 text-xs font-bold text-cyan-200">
            {doctor.subspecialty || doctor.specialty}
          </p>
        </div>
      </div>

      {doctor.bio ? (
        <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-300">
          {doctor.bio}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold text-slate-400">
        <span>
          {doctor.yearsOfExperience} years exp
        </span>

        {doctor.languages.length > 0 ? (
          <span>{doctor.languages.join(", ")}</span>
        ) : null}

        {doctor.consultationPrice !== null ? (
          <span className="text-cyan-300">
            {doctor.consultationPrice} JOD
          </span>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {onChoose ? (
          <button
            type="button"
            onClick={onChoose}
            className="flex items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 font-black text-white transition hover:from-cyan-400 hover:to-blue-500"
          >
            Choose this doctor
          </button>
        ) : null}

        <Link
          href={`/patients/doctors/${doctor.id}?clinic=${clinicKey}`}
          className={`flex items-center justify-center rounded-2xl border border-white/20 bg-white/[0.06] px-5 py-3 font-black text-cyan-200 transition hover:border-cyan-300/50 hover:bg-white/[0.12] ${
            onChoose ? "" : "sm:col-span-2"
          }`}
        >
          View Profile
        </Link>
      </div>
    </article>
  );
}

export { Avatar };
