import { auth } from "@/server/auth/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL ??
  "http://127.0.0.1:8001";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return Response.json(
        {
          success: false,
          message: "You must sign in first.",
        },
        {
          status: 401,
        }
      );
    }

    const incomingFormData =
      await request.formData();

    const image = incomingFormData.get("image");

    if (!(image instanceof File)) {
      return Response.json(
        {
          success: false,
          message: "Please select an X-ray image.",
        },
        {
          status: 400,
        }
      );
    }

    if (image.size === 0) {
      return Response.json(
        {
          success: false,
          message: "The selected image is empty.",
        },
        {
          status: 400,
        }
      );
    }

    const aiFormData = new FormData();

    aiFormData.append(
      "image",
      image,
      image.name
    );

    const aiResponse = await fetch(
      `${AI_SERVICE_URL}/classify`,
      {
        method: "POST",
        body: aiFormData,
        cache: "no-store",
      }
    );

    const result = await aiResponse.json();

    if (!aiResponse.ok) {
      return Response.json(
        {
          success: false,
          message:
            result.detail ||
            result.message ||
            "The AI service could not classify the image.",
        },
        {
          status: aiResponse.status,
        }
      );
    }

    return Response.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error(
      "AI classification API error:",
      error
    );

    return Response.json(
      {
        success: false,
        message:
          "The AI service is unavailable. Make sure the Python server is running on port 8001.",
      },
      {
        status: 503,
      }
    );
  }
}
