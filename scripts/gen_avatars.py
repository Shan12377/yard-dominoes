#!/usr/bin/env python3
"""Generate the 8 player-profile avatars per docs/avatar-set.md.

Local, one-shot generation script — never called at runtime. Reads
OPENAI_API_KEY from .env.local (never committed, never a VITE_ var), calls
gpt-image-1 once per avatar, and writes 128px WebP files into
apps/web/public/avatars/. Re-run and commit whenever the set changes;
regenerate the whole set, never one avatar against a new rule.
"""

import base64
import io
import json
import os
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ENV_LOCAL = ROOT / ".env.local"
OUT_DIR = ROOT / "apps" / "web" / "public" / "avatars"

BASE = (
    "A single flat vector emoji-style character, perfectly centred and upright, "
    "facing straight forward, filling 85% of a square frame. Straight-on front "
    "view only: no tilt, no rotation, no perspective, no lean. The character IS a "
    "domino tile standing upright: bone-white ivory body with softly rounded "
    "corners, a thin dark dividing line across the middle, and pip-holes used as "
    "facial features. Absolutely flat 2D vector art, thick confident outlines, "
    "bold simple shapes, no gradients, no gloss, no 3D rendering, no drop shadows, "
    "no photorealism, no human hands. Solid flat deep forest green background "
    "(#146B3A) filling the whole square, no flag, no pattern, no scenery, no "
    "border, no shadow. Accent colours limited to gold (#E0A400) and warm black. "
    "Reads clearly at 64 pixels. NO text, NO letters, NO words, NO numbers "
    "anywhere in the image. "
)

AVATARS = {
    "tam": (
        "The character wears a knitted red, gold and green tam sitting high on "
        "its head with a few thick dark locs falling out beneath it, and its "
        "expression is calm and settled, at rest, neither smiling nor frowning."
    ),
    "wrap": (
        "The character wears a gold fabric head-wrap tied high in a knot above "
        "its head, and its expression is calm and settled, at rest, neither "
        "smiling nor frowning."
    ),
    "granny": (
        "The character is an elder wearing small round reading glasses low on "
        "its face and a few pink hair curlers above, and its expression is "
        "calm, patient and unimpressed, at rest, neither smiling nor frowning."
    ),
    "straw": (
        "The character wears a wide-brim woven straw yard hat with a warm "
        "black band, shading the top of its face, and its expression is calm "
        "and settled, at rest, neither smiling nor frowning."
    ),
    "hoops": (
        "The character wears large gold hoop earrings on each side with its "
        "dark hair slicked back flat, and its expression is calm and "
        "confident, at rest, neither smiling nor frowning, with a short "
        "straight neutral mouth line matching the other characters in the set."
    ),
    "cap": (
        "The character wears a warm black flat cap tilted slightly, with its "
        "mouth closed in a short straight neutral line and a single small "
        "gold tooth visible right at the centre of that closed line — not an "
        "open mouth, not a smile — and its expression is otherwise calm and "
        "settled, at rest, neither smiling nor frowning."
    ),
    "phones": (
        "The character wears large warm black over-ear headphones with a "
        "gold band across the top of its head, and its expression is calm "
        "and settled, at rest, neither smiling nor frowning, with a short "
        "straight neutral mouth line matching the other characters in the set."
    ),
    "plain": (
        "The character wears nothing at all and carries only a thin gold "
        "outline around the edge of its body, and its expression is calm and "
        "settled, at rest, neither smiling nor frowning."
    ),
}


def load_api_key() -> str:
    if not ENV_LOCAL.exists():
        sys.exit(f"missing {ENV_LOCAL}")
    for line in ENV_LOCAL.read_text().splitlines():
        line = line.strip()
        if line.startswith("OPENAI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("OPENAI_API_KEY not found in .env.local")


def generate(prompt: str, api_key: str) -> bytes:
    body = json.dumps({
        "model": "gpt-image-1",
        "prompt": prompt,
        "size": "1024x1024",
        "quality": "medium",
        "n": 1,
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/generations",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read())
    b64 = payload["data"][0]["b64_json"]
    return base64.b64decode(b64)


def main() -> None:
    api_key = load_api_key()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    requested = sys.argv[1:]
    targets = {k: v for k, v in AVATARS.items() if k in requested} if requested else AVATARS
    if requested:
        unknown = set(requested) - set(AVATARS)
        if unknown:
            sys.exit(f"unknown avatar id(s): {', '.join(sorted(unknown))}")

    for avatar_id, line in targets.items():
        prompt = BASE + line
        print(f"generating {avatar_id}...")
        png_bytes = generate(prompt, api_key)
        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        img = img.resize((128, 128), Image.LANCZOS)
        out_path = OUT_DIR / f"{avatar_id}.webp"
        img.save(out_path, "WEBP", quality=90)
        size_kb = out_path.stat().st_size / 1024
        print(f"  wrote {out_path} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
