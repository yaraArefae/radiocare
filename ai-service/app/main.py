from io import BytesIO

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError


app = FastAPI(
    title="RadioCare Service",
    version="1.0.0",
)


# Allow the Next.js frontend to communicate with Python.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}

MAX_FILE_SIZE = 20 * 1024 * 1024


@app.get("/")
def root():
    return {
        "success": True,
        "message": "RadioCare service is running.",
    }


@app.get("/health")
def health_check():
    return {
        "success": True,
        "status": "healthy",
        "modelLoaded": False,
    }


@app.post("/classify")
async def classify_image(
    image: UploadFile = File(...)
):
    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Only JPG, PNG and WEBP images are currently supported.",
        )

    image_bytes = await image.read()

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="The uploaded image is empty.",
        )

    if len(image_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail="The image must be smaller than 20 MB.",
        )

    try:
        pil_image = Image.open(
            BytesIO(image_bytes)
        ).convert("RGB")

    except UnidentifiedImageError as error:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid image.",
        ) from error

    width, height = pil_image.size

    return {
        "success": True,
        "message": (
            "The image was received successfully. "
            "The classification model has not been trained yet."
        ),
        "fileName": image.filename,
        "contentType": image.content_type,
        "width": width,
        "height": height,
        "bodyRegion": None,
        "confidence": None,
    }
