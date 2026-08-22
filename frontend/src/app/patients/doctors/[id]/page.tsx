"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Avatar,
  Rating,
  type PublicDoctor,
} from "@/components/DoctorCard";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

type Review = {
  rating: number;
  comment: string | null;
  createdAt: string;
  patientName: string;
};

/*
  A single fact on the profile: a label and the value under it. Kept as
  one component so that a missing value is left out everywhere rather
  than drawn as an empty box on one card and a dash on another.
*/
function Fact({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  if (value === null || value === "" || value === undefined) return null;

  return (
    <div className="rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 font-bold text-white">{value}</p>
    </div>
  );
}

export default function DoctorProfilePage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();

  const [doctor, setDoctor] = useState<PublicDoctor | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const clinicKey = search.get("clinic") ?? "";

  useEffect(() => {
    let active = true;

    fetch(`${BACKEND_URL}/api/doctors/${params.id}`, {
      credentials: "include",
    })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;

        if (!data.success) {
          setError(data.message ?? "This doctor was not found.");
          return;
        }

        setDoctor(data.doctor);
        setReviews(Array.isArray(data.reviews) ? data.reviews : []);
      })
      .catch(() => {
        if (active) setError("This profile could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [params.id]);

  /*
    Choosing from the profile hands the id back to the upload page
    through the address, so a patient who read the profile first does
    not have to find the doctor again in the list.
  */
  function chooseAndReturn() {
    router.push(
      `/patients/upload?doctor=${params.id}${
        clinicKey ? `&clinic=${clinicKey}` : ""
      }`,
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-5 py-8">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/patients/upload"
          className="mb-6 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 backdrop-blur-xl transition hover:border-cyan-300/50"
        >
          ← Back to the upload page
        </Link>

        {loading ? (
          <p className="text-slate-300">Loading the profile...</p>
        ) : error ? (
          <p className="rounded-3xl border border-rose-300/30 bg-rose-400/10 px-6 py-5 font-bold text-rose-200">
            {error}
          </p>
        ) : doctor ? (
          <>
            <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:p-9">
              <div className="flex flex-wrap items-start gap-5">
                <Avatar
                  initials={doctor.initials}
                  name={doctor.name}
                  photoUrl={doctor.photoUrl}
                  size="h-20 w-20 text-2xl"
                />

                <div className="min-w-0 flex-1">
                  <h1 className="text-3xl font-black text-white">
                    {doctor.name}
                  </h1>

                  <p className="mt-2 inline-block rounded-lg bg-cyan-400/15 px-3 py-1 text-sm font-bold text-cyan-200">
                    {doctor.subspecialty || doctor.specialty}
                  </p>

                  <div className="mt-3">
                    <Rating
                      rating={doctor.rating}
                      reviewCount={doctor.reviewCount}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={chooseAndReturn}
                  className="rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 font-black text-white transition hover:from-cyan-400 hover:to-blue-500"
                >
                  Choose this doctor
                </button>
              </div>

              {doctor.bio ? (
                <p className="mt-6 leading-7 text-slate-300">
                  {doctor.bio}
                </p>
              ) : null}
            </section>

            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Fact
                label="Experience"
                value={`${doctor.yearsOfExperience} years`}
              />
              <Fact label="Specialty" value={doctor.specialty} />
              <Fact
                label="Clinics"
                value={doctor.clinicNames.join(", ") || null}
              />
              <Fact
                label="Languages"
                value={doctor.languages.join(", ") || null}
              />
              <Fact
                label="Workplace"
                value={doctor.currentWorkplace || null}
              />
              <Fact
                label="Consultation"
                value={
                  doctor.consultationPrice === null
                    ? null
                    : `${doctor.consultationPrice} JOD`
                }
              />
            </section>

            {/*
              The licence is the part of a profile a patient can check
              for themselves against the authority that issued it, which
              is worth more than any wording this page could add.
            */}
            <section className="mt-6 rounded-3xl border border-white/15 bg-white/[0.05] p-6">
              <h2 className="text-lg font-black text-white">
                Licence
              </h2>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Fact
                  label="Licence number"
                  value={doctor.licenseNumber || null}
                />
                <Fact
                  label="Issued by"
                  value={doctor.licensingAuthority || null}
                />
              </div>
            </section>

            <section className="mt-6 rounded-3xl border border-white/15 bg-white/[0.05] p-6">
              <h2 className="text-lg font-black text-white">
                What patients said
              </h2>

              {reviews.length === 0 ? (
                <p className="mt-3 leading-6 text-slate-400">
                  No patient has rated a reading by this doctor yet. The
                  rating on this page is built only from patients who
                  received a report, so it stays empty until then.
                </p>
              ) : (
                <ul className="mt-4 grid gap-3">
                  {reviews.map((review, index) => (
                    <li
                      key={index}
                      className="rounded-2xl border border-white/12 bg-white/[0.05] px-5 py-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-white">
                          {review.patientName}
                        </span>
                        <span className="font-black text-amber-200">
                          {"★".repeat(review.rating)}
                          <span className="text-white/25">
                            {"★".repeat(5 - review.rating)}
                          </span>
                        </span>
                      </div>

                      {review.comment ? (
                        <p className="mt-2 leading-6 text-slate-300">
                          {review.comment}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
