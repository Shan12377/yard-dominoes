#!/usr/bin/env python3
"""Generate the cosmetic yard-scene backgrounds, plan section 7.1.

Local, one-shot generation script — never called at runtime. Reads
OPENAI_API_KEY from .env.local (never committed, never a VITE_ var), calls
gpt-image-1 once per scene, and writes WebP files into
apps/web/public/backgrounds/. Re-run and commit whenever the set changes;
regenerate the whole set, never one scene against a new rule (same
discipline as gen_avatars.py and docs/art-direction.md's "change the
template, regenerate the whole set" rule).

These are scenery, not the single-character icon docs/art-direction.md
governs — that template explicitly forbids scenery (rule 4: "no scenery" on
the solid-green icon background). The register these follow instead is
design.md's Illustration section: yard-band.svg's flat-vector, four-colour,
"dancehall flyer silhouette, never a travel-brochure beach" style.
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
OUT_DIR = ROOT / "apps" / "web" / "public" / "backgrounds"

BASE = (
    "A flat 2D vector illustration in a dancehall flyer silhouette style — "
    "bold simple shapes, thick confident outlines, no gradients, no gloss, "
    "no 3D rendering, no photorealism, no photographic elements anywhere. A "
    "wide banner-format scene of a Jamaican domino yard, built from exactly "
    "four flat colours: cream (#FAF3E1), forest green (#146B3A), warm gold "
    "(#E0A400), and warm near-black ink (#241608) — nothing else, no other "
    "hues. This is NOT a travel-brochure postcard beach: no turquoise water, "
    "no sunset gradient, no tourist iconography, no palm-fringed horizon "
    "shot. It is a lived-in concrete yard, not a resort. NO text, NO "
    "letters, NO words, NO numbers anywhere in the image. If any people "
    "appear, at least half must be women, and at least one person shown "
    "must be playing dominoes or winning, never just watching — vary age "
    "and shade. "
)

BACKGROUNDS = {
    "midday": (
        "Midday sun directly overhead casting hard flat shadows across a "
        "bare concrete yard. A domino table sits under a simple covered "
        "patio roof. Full daylight strength, forest green and gold at their "
        "brightest, cream sky."
    ),
    "evening": (
        "Evening scene at dusk. A string of small round lightbulbs is "
        "strung overhead across the yard, warm gold glow from the bulbs "
        "standing out against a darker ink-and-forest-green dusk palette. "
        "The domino table sits beneath the lights."
    ),
    "rain": (
        "Rain falling on a corrugated zinc roof over a covered yard patio. "
        "Rain is rendered as thin flat gold-tinted diagonal lines against "
        "the ink sky. A puddle on the concrete reflects warm light. The "
        "domino table stays dry and sheltered underneath the roof."
    ),
    "beach": (
        "A Caribbean beach scene, midday. Real coconut palms lean over a "
        "small domino table set up directly on the sand, with two or three "
        "people actively playing — one mid-slam, tile striking the table, "
        "another laughing. The sea is a flat simple shape at the edge of "
        "frame, not the subject of the image. This must read as a real "
        "domino game that happens to be on a beach, NOT a travel-brochure "
        "postcard: no empty horizon shot, no umbrella drinks, no beach "
        "chairs, no sunset gradient, nobody merely lounging."
    ),
    "shop": (
        "The classic Jamaican corner shop: a small roadside shop building "
        "with a corrugated zinc roof, painted in bold blocks of the "
        "palette colours, a hand-painted shutter or door, a serving window. "
        "A domino table is set up just outside under the shop's awning, "
        "two or three people playing, one slamming a tile down hard. This "
        "is a real, lived-in neighbourhood spot, not a tourist bar or "
        "resort — weathered paint, a plastic crate for a stool, nothing "
        "polished. No alcohol bottles, signage, or branding of any kind "
        "visible anywhere in the scene."
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
        "size": "1536x1024",
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
    targets = {k: v for k, v in BACKGROUNDS.items() if k in requested} if requested else BACKGROUNDS
    if requested:
        unknown = set(requested) - set(BACKGROUNDS)
        if unknown:
            sys.exit(f"unknown background id(s): {', '.join(sorted(unknown))}")

    for bg_id, line in targets.items():
        prompt = BASE + line
        print(f"generating {bg_id}...")
        png_bytes = generate(prompt, api_key)
        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        img = img.resize((480, 320), Image.LANCZOS)
        out_path = OUT_DIR / f"{bg_id}.webp"
        img.save(out_path, "WEBP", quality=82)
        size_kb = out_path.stat().st_size / 1024
        print(f"  wrote {out_path} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
