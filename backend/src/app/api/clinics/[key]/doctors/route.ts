import {
  CLINIC_KEYS,
  getClinicDefinition,
  type ClinicKey,
} from "@/server/clinics/clinic-key";
import { databaseReady } from "@/server/database/database";
import { doctorsInClinic } from "@/server/doctors/public-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ key: string }>;
};

/*
  The doctors a patient can choose from inside one clinic.

  This is deliberately readable without signing in. A patient comparing
  doctors before deciding whether to use the service at all should not
  have to register first, and nothing here is private: a name, a
  specialty, a licence number that is already public, and ratings that
  patients wrote to be read.
*/
export async function GET(
  request: Request,
  context: RouteContext,
) {
  try {
    const { key } = await context.params;
    const clinicKey = String(key).trim().toLowerCase();

    if (!(CLINIC_KEYS as string[]).includes(clinicKey)) {
      return Response.json(
        {
          success: false,
          message: `Unknown clinic: ${key}`,
        },
        { status: 404 },
      );
    }

    await databaseReady;

    const clinic = getClinicDefinition(clinicKey);
    const doctors = await doctorsInClinic(clinicKey as ClinicKey);

    return Response.json({
      success: true,
      clinic: {
        key: clinic.key,
        name: clinic.name,
        specialty: clinic.specialty,
        description: clinic.description,
      },
      doctors,
    });
  } catch (error) {
    console.error("Clinic doctors API error:", error);

    return Response.json(
      {
        success: false,
        message: "The doctors of this clinic could not be loaded.",
      },
      { status: 500 },
    );
  }
}
