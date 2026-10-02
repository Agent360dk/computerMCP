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
    par = m.get('par') or [[m['fra'], m['til']]]
    tael = [orig.count(a) for a, _ in par]
    if any(t != 1 for t in tael):
        fejl.append(f"{m['navn']}: ankrene findes {tael} gange"); continue
    muteret = orig
    for a, b in par: muteret = muteret.replace(a, b)
    try:
        open(m['fil'], 'w', encoding='utf-8').write(muteret)
        try:
            k = subprocess.run(['node', m['proeve']], capture_output=True, text=True, timeout=600)
            rc, ud = k.returncode, k.stdout
        except subprocess.TimeoutExpired:
            rc, ud = 'timeout', ''
    finally:
        open(m['fil'], 'w', encoding='utf-8').write(orig)
    if hashlib.sha256(open(m['fil'], encoding='utf-8').read().encode()).hexdigest() != h:
        fejl.append(f"{m['navn']}: {m['fil']} blev IKKE gendannet"); break
    # ⛔ Runde 1 30/9 (Astra 9): enhver ikke-nul exit talte som «roed» - ogsaa en
    #    prove der crashede for foerste assertion. Roed = rc 1 OG en DUMP-linje.
    # ⛔ Runde 2 (Astra 7): en tilfaeldig ANDEN DUMP-linje var ogsaa «bevis». Nu skal
    #    den prove mutanten er skrevet til (`forventet`), vaere en af de roede.
    doemt = [l for l in ud.splitlines() if l.startswith('DUMP ' + m.get('forventet', ''))]
    if rc == 0:
        overlevede.append(m['navn']); print(f"::error::mutanten {m['navn']} overlevede - {m['proeve']} maaler ikke")
    elif rc == 1 and doemt:
        print(f"mutanten {m['navn']} er roed ({m['proeve']}: {doemt[0][:90]})")
    else:
        fejl.append(f"{m['navn']}: instrumentet svarede ikke (rc={rc}, {len(doemt)} DUMP-linjer) - det er ikke et bevis")
for f in fejl: print(f"::error::{f}")
print(f"{len(overlevede)} overlevede, {len(fejl)} fejl")
sys.exit(1 if overlevede or fejl else 0)
