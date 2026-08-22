"""
Turns the exported sample volumes into pictures a person can open.

A .nii.gz holds a stack of slices, and no ordinary computer knows how to
draw one: double clicking it opens nothing. That is a problem for anyone
who wants to look at what they are about to upload, so every sample is
rendered twice here.

    a PNG contact sheet   every slice of the volume laid out in a grid,
                          the way a radiologist reads a series
    an animated GIF       the same slices played in order, which is
                          closer to scrolling through a real study

Both open by double clicking on any machine.

    python scripts/preview_3d_samples.py
    python scripts/preview_3d_samples.py --output "C:/Users/User/Desktop/RadioCare-3D-Samples"

The true finding stays in the file name, so a picture can always be
checked against the answer it is supposed to have.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = PROJECT_ROOT / "data" / "_samples_3d"

"""
The volumes are 28 or 64 voxels a side, which is thumbnail sized. Each
slice is enlarged so the shapes inside it can actually be seen, using
nearest neighbour: a smooth interpolation would invent detail that the
scan does not contain, and on a medical image that is worse than a
blocky one.
"""
TILE_SIZE = 112
GRID_GAP = 2
GIF_FRAME_MS = 120


def to_display_range(volume: np.ndarray) -> np.ndarray:
    """
    Stretches the volume between its own darkest and brightest voxel.

    A prepared volume already sits between 0 and 255, but a crop of soft
    tissue can occupy a narrow band of that range and come out as a flat
    grey rectangle. Stretching it is the same thing a radiologist does
    when they adjust the window on the screen.
    """
    volume = volume.astype(np.float32)
    low = float(volume.min())
    high = float(volume.max())

    if high - low < 1e-6:
        return np.zeros_like(volume, dtype=np.uint8)

    scaled = (volume - low) / (high - low) * 255.0
    return scaled.astype(np.uint8)


def slice_images(volume: np.ndarray) -> list[Image.Image]:
    return [
        Image.fromarray(slice_data, mode="L").resize(
            (TILE_SIZE, TILE_SIZE),
            Image.NEAREST,
        )
        for slice_data in volume
    ]


def build_contact_sheet(
    frames: list[Image.Image],
) -> Image.Image:
    columns = int(np.ceil(np.sqrt(len(frames))))
    rows = int(np.ceil(len(frames) / columns))

    width = columns * TILE_SIZE + (columns - 1) * GRID_GAP
    height = rows * TILE_SIZE + (rows - 1) * GRID_GAP

    sheet = Image.new("L", (width, height), color=32)

    for index, frame in enumerate(frames):
        column = index % columns
        row = index // columns
        sheet.paste(
            frame,
            (
                column * (TILE_SIZE + GRID_GAP),
                row * (TILE_SIZE + GRID_GAP),
            ),
        )

    return sheet


def render_volume(source: Path, output_dir: Path) -> None:
    volume = to_display_range(np.load(source))
    frames = slice_images(volume)

    output_dir.mkdir(parents=True, exist_ok=True)

    build_contact_sheet(frames).save(
        output_dir / f"{source.stem}_slices.png"
    )

    frames[0].save(
        output_dir / f"{source.stem}_scroll.gif",
        save_all=True,
        append_images=frames[1:],
        duration=GIF_FRAME_MS,
        loop=0,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render the sample volumes as pictures."
    )
    parser.add_argument(
        "--samples",
        type=Path,
        default=SAMPLES_DIR,
        help="Folder holding the exported samples.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help=(
            "Where to write the pictures. Defaults to a 'previews' "
            "folder inside each sample folder."
        ),
    )
    arguments = parser.parse_args()

    samples_dir = arguments.samples

    if not samples_dir.exists():
        print(
            f"No samples were found in {samples_dir}.\n"
            "Run scripts/export_3d_samples.py first."
        )
        return

    written = 0

    for volume_path in sorted(samples_dir.glob("*/*.npy")):
        folder = volume_path.parent.name

        if arguments.output is not None:
            output_dir = arguments.output / folder / "previews"
        else:
            output_dir = volume_path.parent / "previews"

        render_volume(volume_path, output_dir)
        written += 1

    if written == 0:
        print(f"No .npy volumes were found under {samples_dir}.")
        return

    print(f"{written} volumes rendered as PNG and GIF.")


if __name__ == "__main__":
    main()
