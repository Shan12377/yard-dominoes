#!/usr/bin/env python3
"""Generate the table-talk reaction tiles (REACTIONS in lounges.ts).

Local, one-shot generation script — never called at runtime. Reads
OPENAI_API_KEY from .env.local (never committed, never a VITE_ var), calls
gpt-image-1 once per reaction, and writes WebP files into
apps/web/public/reactions/. Re-run and commit whenever the set changes.

Every id in this dict is meant to exist forever, including the six already
committed — that way a future template change (see docs/art-direction.md's
"change the template, regenerate the whole set" rule) has one script that
covers the entire set, not just whatever was added most recently. Pass
specific ids on the command line to regenerate only those (used here to add
five new reactions without re-spending on six that already match).

The template executed for the original six is NOT quite what
docs/art-direction.md's prose describes (that file's prompt puts pip-holes
where the EYES are, character-portrait style). The reaction tiles actually
shipped are a distinct variant: a real domino tile split by its spine line,
a conventional cartoon face on the top half, and a genuine pip count on the
bottom half. Reverse-engineered from the six live files rather than the
doc, since matching what's actually in the set matters more than the
written description of a sibling template.

Every new id here is a Jamaican expression, not a translation of a generic
emoticon-set label (see JamDom's "Angry / Big Smile / Confused / Cool /
Sad / Surprised" VIP emoticon list — the naming, not the coverage, is
exactly what a copy would get wrong). Picked to fill genuine gaps in what
the existing six already cover at a domino table: shock, disbelief at a
move, unbothered confidence, boredom, and sarcastic mockery.
"""

import base64
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ENV_LOCAL = ROOT / ".env.local"
OUT_DIR = ROOT / "apps" / "web" / "public" / "reactions"

BASE = (
    "A single flat vector illustration of a Jamaican dominoes tile "
    "character, upright, centred, filling about 85% of a square frame, "
    "front-on with no tilt, no rotation, no perspective, no lean. The tile "
    "is a rounded-corner vertical domino: cream/bone-white body "
    "(#FDF6E3), thick confident dark ink outline (#241608), with a thin "
    "dark horizontal dividing line across the middle splitting it into two "
    "halves. The TOP half is a simple flat cartoon face — eyebrows, eyes "
    "and a mouth drawn as bold simple flat shapes, NOT pip-holes as eyes. "
    "The BOTTOM half shows a genuine domino pip pattern of dots, arranged "
    "like a real domino face. Absolutely flat 2D vector art, no gradients, "
    "no gloss, no 3D rendering, no drop shadows, no photorealism, no human "
    "hands. Solid flat deep forest green background (#146B3A) filling the "
    "whole square edge to edge — nothing else, no pattern, no border, no "
    "shadow, no scenery. Gold (#E0A400) may accent parts of the FACE — "
    "an iris, a highlight, a detail on the eyes or mouth — the same way "
    "warm gold accents appear across this whole tile set. But the "
    "BOTTOM-HALF PIPS must always be solid black/dark ink (#241608), "
    "matching the outline colour, with NO exceptions in this batch — "
    "never gold pips. If the description below says the tile is blank, "
    "the entire bottom half is flat solid cream with absolutely nothing "
    "drawn on it and no glow, halo, or gradient anywhere on or around "
    "the tile. NO text, NO letters, NO words, NO numbers anywhere in the "
    "image. Reads clearly at 64 pixels. "
)

REACTIONS = {
    # --- already committed; kept here so the whole set can be regenerated
    # together if the template itself ever changes ---
    "tek-dat": (
        "The face is delighted and triumphant, eyes closed in a wide happy "
        "grin, mouth open laughing. The bottom pip pattern is 2 dots."
    ),
    "mi-pass": (
        "The face is resigned and glum, heavy drooping eyelids, a flat "
        "downturned mouth. The bottom pip pattern is 2 dots."
    ),
    "yah-suh": (
        "The face gives a knowing wink — one eye closed, the other open "
        "with a small confident smile. The bottom pip pattern is 2 dots."
    ),
    "six-love": (
        "EXCEPTION to the no-gold rule above, for this tile only: the "
        "face is ecstatic, gold star shapes in place of the eyes, mouth "
        "wide open cheering. The bottom pip pattern is a single dot and "
        "that one dot IS gold (#E0A400), not black — the only gold "
        "allowed anywhere in this specific image."
    ),
    "hold-dat": (
        "The face is angry, sharp downward-slanted eyebrows, mouth open "
        "shouting. The bottom pip pattern is 6 dots (two columns of "
        "three)."
    ),
    "cho-man": (
        "The face is annoyed and skeptical, half-lidded sideways-rolling "
        "eyes, a small pursed frown. The bottom pip pattern is 5 dots (a "
        "domino five, four corners plus the centre)."
    ),
    # --- new: fill emotional gaps, named in patois rather than translated
    # from a generic emoticon-set label ---
    "lawd": (
        "The face is genuinely shocked — eyebrows shot up high, eyes wide "
        "open and round, mouth a small open circle. The bottom pip "
        "pattern is 3 dots (a diagonal domino three)."
    ),
    "yuh-mad": (
        "The face is deeply skeptical and disbelieving — one eyebrow "
        "raised sharply higher than the other, eyes narrowed to a "
        "squint, mouth a flat line tilted to one side. The bottom pip "
        "pattern is 4 dots (a domino four, one in each corner)."
    ),
    "cool-runnings": (
        "The face is completely unbothered and confident — relaxed "
        "half-lidded eyes, a small closed-mouth satisfied smile, calm. "
        "The bottom half is BLANK, no pips at all — the chucha, the "
        "coolest tile in the set. The blank bottom half is FLAT SOLID "
        "cream with a crisp edge at the dividing line, exactly like every "
        "other tile in this set — absolutely no glow, no halo, no soft "
        "light bloom, no vignette, no gradient of any kind anywhere on "
        "or around the tile. Flat vector only, same as the rest."
    ),
    "mi-tired": (
        "The face is sleepy and bored — very heavy near-closed eyelids, "
        "mouth open mid-yawn. The bottom pip pattern is a single small "
        "dot, off-centre, as if there is barely enough energy for more."
    ),
    "big-up": (
        "The face is smugly sarcastic — one eyebrow arched high, eyes "
        "closed in a self-satisfied smirk, mouth curled up on one side "
        "only. The bottom pip pattern is 6 dots (two columns of three), "
        "an ironic echo of a genuinely strong tile for a reaction that "
        "is mocking, not admiring."
    ),
}

NEW_IDS = ["lawd", "yuh-mad", "cool-runnings", "mi-tired", "big-up"]


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

    requested = sys.argv[1:] or NEW_IDS
    targets = {k: v for k, v in REACTIONS.items() if k in requested}
    unknown = set(requested) - set(REACTIONS)
    if unknown:
        sys.exit(f"unknown reaction id(s): {', '.join(sorted(unknown))}")

    for reaction_id, line in targets.items():
        prompt = BASE + line
        print(f"generating {reaction_id}...")
        png_bytes = generate(prompt, api_key)
        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        img = img.resize((128, 128), Image.LANCZOS)
        out_path = OUT_DIR / f"{reaction_id}.webp"
        img.save(out_path, "WEBP", quality=90)
        size_kb = out_path.stat().st_size / 1024
        print(f"  wrote {out_path} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
