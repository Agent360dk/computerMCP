#!/usr/bin/env python3
# Mutationsbevis for portene (29/9, B7 - MANDAT: «hver vagt skal kunne blive roed»).
# Hver mutant i mutanter-porte.json bygger én fejl ind i en vagt; dens proeve SKAL
# blive roed. Filen gendannes ALTID fra en kopi taget lige foer - aldrig fra git,
# for filen kan baere ucommittet arbejde (30/9: `git checkout` tog en hel funktion).
import hashlib, json, os, subprocess, sys
ROD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROD)
overlevede, fejl = [], []
for m in json.load(open('.github/mutanter-porte.json', encoding='utf-8')):
    orig = open(m['fil'], encoding='utf-8').read()
    h = hashlib.sha256(orig.encode()).hexdigest()
    if orig.count(m['fra']) != 1:
        fejl.append(f"{m['navn']}: ankeret findes {orig.count(m['fra'])} gange"); continue
    try:
        open(m['fil'], 'w', encoding='utf-8').write(orig.replace(m['fra'], m['til']))
        try:
            rc = subprocess.run(['node', m['proeve']], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600).returncode
        except subprocess.TimeoutExpired:
            rc = 'timeout'
    finally:
        open(m['fil'], 'w', encoding='utf-8').write(orig)
    if hashlib.sha256(open(m['fil'], encoding='utf-8').read().encode()).hexdigest() != h:
        fejl.append(f"{m['navn']}: {m['fil']} blev IKKE gendannet"); break
    if rc == 0:
        overlevede.append(m['navn']); print(f"::error::mutanten {m['navn']} overlevede - {m['proeve']} maaler ikke")
    else:
        print(f"mutanten {m['navn']} er roed ({m['proeve']}, rc={rc})")
for f in fejl: print(f"::error::{f}")
print(f"{len(overlevede)} overlevede, {len(fejl)} fejl")
sys.exit(1 if overlevede or fejl else 0)
