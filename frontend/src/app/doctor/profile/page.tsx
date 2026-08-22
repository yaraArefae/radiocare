"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useRef, useState } from "react";

import SecretaryCard from "@/components/SecretaryCard";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

type MyProfile = {
  id: string;
  name: string;
  specialty: string;
  subspecialty: string | null;
  bio: string | null;
  languages: string[];
  consultationPrice: number | null;
  yearsOfExperience: number;
  clinicNames: string[];
  rating: number | null;
  reviewCount: number;
  initials: string;
  photoUrl: string | null;
};

export default function DoctorProfilePage() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  /*
    Bumped after a photo is replaced so the browser fetches the new one.
    The address never changes, and without this the old face stays on
    screen until the cache expires.
  */
  const [photoVersion, setPhotoVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const [bio, setBio] = useState("");
  const [languages, setLanguages] = useState("");
  const [price, setPrice] = useState("");

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/doctor/profile`, {
      credentials: "include",
    })
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) {
          setFailed(true);
          setMessage(data.message ?? "Your profile could not be loaded.");
          return;
        }

        setProfile(data.doctor);
        setBio(data.doctor.bio ?? "");
        setLanguages((data.doctor.languages ?? []).join(", "));
        setPrice(
          data.doctor.consultationPrice === null
            ? ""
            : String(data.doctor.consultationPrice),
        );
      })
      .catch(() => {
        setFailed(true);
        setMessage("Your profile could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, []);

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    setSaving(true);
    setFailed(false);
    setMessage("");

    try {
      const form = new FormData();
      form.append("photo", file);

      const response = await fetch(`${BACKEND_URL}/api/doctor/photo`, {
        method: "POST",
        credentials: "include",
        body: form,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "Your photo could not be saved.");
      }

      setProfile((current) =>
        current ? { ...current, photoUrl: data.photoUrl } : current,
      );
      setPhotoVersion((version) => version + 1);
      setMessage(data.message);
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Your photo could not be saved.",
      );
    } finally {
      setSaving(false);

      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function saveDetails() {
    setSaving(true);
    setFailed(false);
    setMessage("");

    try {
      const response = await fetch(`${BACKEND_URL}/api/doctor/profile`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bio,
          languages: languages
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          consultationPrice: price.trim() === "" ? null : Number(price),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "Your profile could not be saved.");
      }

      setMessage(data.message);
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Your profile could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-5 py-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/doctor/clinic"
          className="mb-6 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 backdrop-blur-xl transition hover:border-cyan-300/50"
        >
          ← Back to your clinic
        </Link>

        <h1 className="text-3xl font-black text-white">
          Your public profile
        </h1>

        <p className="mt-2 max-w-2xl leading-7 text-slate-300">
          This is what a patient sees when they choose a doctor in your
          clinic. Your name, specialty, licence and years of experience
          come from your approved application and cannot be edited here.
        </p>

        {loading ? (
          <p className="mt-8 text-slate-300">Loading...</p>
        ) : profile ? (
          <>
            <section className="mt-7 rounded-3xl border border-white/20 bg-white/[0.07] p-7 backdrop-blur-2xl">
              <div className="flex flex-wrap items-center gap-6">
                {profile.photoUrl ? (
                  <img
                    src={`${BACKEND_URL}${profile.photoUrl}?v=${photoVersion}`}
                    alt={profile.name}
                    className="h-24 w-24 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-3xl font-black text-white">
                    {profile.initials}
                  </div>
                )}

                <div>
                  <p className="text-2xl font-black text-white">
                    {profile.name}
                  </p>
                  <p className="mt-1 text-sm font-bold text-cyan-200">
                    {profile.subspecialty || profile.specialty}
                    {" · "}
                    {profile.yearsOfExperience} years
                  </p>

                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={saving}
                    className="mt-3 rounded-xl border border-white/20 bg-white/[0.06] px-4 py-2 text-sm font-bold text-cyan-200 transition hover:border-cyan-300/50 disabled:opacity-50"
                  >
                    {profile.photoUrl ? "Change photo" : "Add a photo"}
                  </button>

                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={uploadPhoto}
                    className="hidden"
                  />

                  <p className="mt-2 text-xs text-slate-400">
                    JPG, PNG or WEBP, up to 5 MB. Patients see this
                    photo; your identity papers stay private.
                  </p>
                </div>
              </div>
            </section>

            <section className="mt-6 rounded-3xl border border-white/20 bg-white/[0.07] p-7 backdrop-blur-2xl">
              <label className="block text-sm font-bold text-slate-200">
                About you
              </label>
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                rows={4}
                maxLength={600}
                placeholder="A short description patients read before choosing you."
                className="mt-2 w-full rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
              />

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-bold text-slate-200">
                    Languages
                  </label>
                  <input
                    value={languages}
                    onChange={(event) => setLanguages(event.target.value)}
                    placeholder="Arabic, English"
                    className="mt-2 w-full rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-200">
                    Consultation price (JOD)
                  </label>
                  <input
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    inputMode="decimal"
                    placeholder="50"
                    className="mt-2 w-full rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={saveDetails}
                disabled={saving}
                className="mt-6 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 font-black text-white transition hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save profile"}
              </button>
            </section>

            <SecretaryCard />
          </>
        ) : null}

        {message ? (
          <p
            className={`mt-5 font-bold ${
              failed ? "text-rose-300" : "text-emerald-300"
            }`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}
