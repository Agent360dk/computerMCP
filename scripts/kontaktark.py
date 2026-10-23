#!/usr/bin/env python3
"""Kontaktark (B3): ét billede pr. use case (før/efter) i en HTML-rapport.

Tager de film "Fremmed Mac"-jobbet allerede optager (brug-baggrund-*.mp4,
brug-forgrund-*.mp4, parallel-*.mp4) og bygger en statisk HTML-side med et
"før"- og "efter"-billede pr. brugsscenarie, så man kan SE at hver use case
leverer uden at se alle filmene i fuld længde.

⛔ Rører ikke produktionskoden og tager ikke skærmen - trækker kun billeder
   ud af film der allerede er optaget af et tidligere CI-trin.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

NAVN_MOENSTER = re.compile(r"^brug-(baggrund|forgrund)-(\d+)-(.+)\.mp4$")


def varighed(sti: Path) -> float:
    ud = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(sti)],
        capture_output=True, text=True, check=True)
    return float(ud.stdout.strip())


def traek_billede(sti: Path, sekund: float, ud: Path) -> None:
    ud.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{sekund:.2f}",
         "-i", str(sti), "-frames:v", "1", "-vf", "scale=480:-2", "-y", str(ud)],
        check=True)


def main() -> None:
    if len(sys.argv) != 3:
        print("brug: kontaktark.py <film-mappe> <output-mappe>", file=sys.stderr)
        sys.exit(2)
    film_dir = Path(sys.argv[1])
    ud_dir = Path(sys.argv[2])
    billed_dir = ud_dir / "billeder"
    billed_dir.mkdir(parents=True, exist_ok=True)

    use_cases: dict[tuple[str, str], dict] = {}
    parallelle: list[dict] = []

    for fil in sorted(film_dir.glob("*.mp4")):
        m = NAVN_MOENSTER.match(fil.name)
        if m:
            tilstand, nr, navn = m.groups()
            try:
                v = varighed(fil)
            except subprocess.CalledProcessError:
                continue
            foer = billed_dir / f"{tilstand}-{nr}-foer.png"
            efter = billed_dir / f"{tilstand}-{nr}-efter.png"
            traek_billede(fil, min(2.0, v * 0.15), foer)
            traek_billede(fil, max(0.0, v - 1.0), efter)
            key = (nr, navn)
            use_cases.setdefault(key, {})[tilstand] = {
                "foer": foer.relative_to(ud_dir), "efter": efter.relative_to(ud_dir),
                "varighed": round(v, 1), "fil": fil.name,
            }
        elif fil.name.startswith("parallel-"):
            try:
                v = varighed(fil)
            except subprocess.CalledProcessError:
                continue
            billed = billed_dir / f"{fil.stem}-midt.png"
            traek_billede(fil, v * 0.5, billed)
            parallelle.append({"navn": fil.stem, "billede": billed.relative_to(ud_dir),
                                "varighed": round(v, 1), "fil": fil.name})

    rows = []
    for (nr, navn), tilstande in sorted(use_cases.items(), key=lambda x: int(x[0][0])):
        celler = []
        for tilstand in ("baggrund", "forgrund"):
            d = tilstande.get(tilstand)
            if not d:
                celler.append(f"<td class='mangler'>{tilstand}: ikke kørt</td>")
                continue
            celler.append(
                f"<td><div class='tilstand'>{tilstand} · {d['varighed']}s · "
                f"<code>{d['fil']}</code></div>"
                f"<div class='par'><img src='{d['foer']}' alt='før'><img src='{d['efter']}' alt='efter'></div></td>"
            )
        rows.append(f"<tr><th>{nr}. {navn.replace('-', ' ')}</th>{''.join(celler)}</tr>")

    par_rows = "".join(
        f"<div class='pcard'><h3>{p['navn']} · {p['varighed']}s</h3>"
        f"<img src='{p['billede']}' alt='{p['navn']}'></div>"
        for p in parallelle
    )

    html = f"""<!doctype html><html lang="da"><head><meta charset="utf-8">
<title>Kontaktark · computer-mcp brugsscenarier</title>
<style>
body{{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#0b0c0f;color:#e8e8ec}}
h1{{font-size:1.3rem}} h2{{margin-top:2rem}}
table{{width:100%;border-collapse:collapse;margin-top:1rem}}
th,td{{border:1px solid #2a2c33;padding:10px;vertical-align:top;text-align:left}}
th{{width:220px;font-size:.85rem}}
.tilstand{{font-size:.75rem;color:#9aa0ab;margin-bottom:6px}}
.par{{display:flex;gap:6px}} .par img{{width:48%;border-radius:4px;border:1px solid #333}}
.mangler{{color:#666;font-style:italic}}
.pgrid{{display:flex;flex-wrap:wrap;gap:16px;margin-top:1rem}}
.pcard{{width:300px}} .pcard img{{width:100%;border-radius:4px;border:1px solid #333}}
.pcard h3{{font-size:.8rem;font-weight:600;color:#9aa0ab}}
code{{background:#1a1c22;padding:1px 4px;border-radius:3px}}
</style></head><body>
<h1>Kontaktark · hver use case, før og efter (B3)</h1>
<p>Trukket automatisk fra filmene i dette CI-job. Intet er optaget på Gustavs Mac.</p>
<table><tr><th>Scenarie</th><th>Baggrund</th><th>Forgrund</th></tr>{''.join(rows)}</table>
<h2>Parallelle agenter</h2>
<div class="pgrid">{par_rows}</div>
</body></html>"""
    (ud_dir / "index.html").write_text(html, encoding="utf-8")
    print(f"Kontaktark skrevet: {ud_dir / 'index.html'} ({len(use_cases)} scenarier, {len(parallelle)} parallel-film)")


if __name__ == "__main__":
    main()
