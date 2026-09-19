#!/usr/bin/env python3
"""Skriver vaerktoejstallet fra koden ud paa hver tekstflade.

⛔ Findes fordi tallet gik 12 -> 18 -> 19 -> 21 -> 22 -> 23 -> 25 paa EEN dag,
   og jeg rettede otte-ni flader i haanden hver gang. Tre gange stod der et
   forkert tal live bagefter - to af dem paa GitHubs repo-beskrivelse, som er
   den flade katalogerne gengiver ordret.

   `test/claims.mjs` claim 15 FANGER driften. Det her RETTER den. Vagten er
   stadig den der bestemmer: koer proeven bagefter.

   Koer: python3 scripts/sync-tal.py
"""
import io, json, os, re, subprocess, sys, glob

ROD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORD = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
       'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen',
       'eighteen','nineteen','twenty','twenty-one','twenty-two','twenty-three',
       'twenty-four','twenty-five','twenty-six','twenty-seven','twenty-eight',
       'twenty-nine','thirty']

ud = subprocess.run(['node','-e',
  "import('./mcp-server/tools.js').then(m=>console.log(JSON.stringify("
  "{n:m.TOOLS.length,l:m.TOOLS.filter(t=>t.tier==='read').length})))"],
  cwd=ROD, capture_output=True, text=True, timeout=60).stdout.strip()
d = json.loads(ud); N, L, S = d['n'], d['l'], d['n']-d['l']
print('koden: %d vaerktoejer (%d laesende, %d skrivende)' % (N, L, S))

FLADER = ['README.md','docs/index.html','docs/tools.html','docs/llms.txt',
          'docs/llms-install.md','docs/docs/capability-matrix/index.html']
FLADER += sorted(x[len(ROD)+1:] for x in glob.glob(ROD+'/docs/docs/install-*/index.html'))

def er_versionsforbehold(t, i):
    # "0.1.0, which has 12 tools" er med RETTE et andet tal.
    return '0.1.0' in t[max(0, i-90):i+20]

i_alt = 0
for f in FLADER:
    p = os.path.join(ROD, f)
    if not os.path.exists(p): continue
    t = io.open(p, encoding='utf-8').read(); foer = t

    def tal(m):
        return m.group(0) if (int(m.group(1)) == N or er_versionsforbehold(t, m.start())) \
               else '%d tools' % N
    t = re.sub(r'\b(\d+) tools\b', tal, t)
    t = re.sub(r'\bThe (\d+) on this page\b', 'The %d on this page' % N, t)
    t = re.sub(r'\b(\d+) of them read-only\b', '%d of them read-only' % L, t)

    # ⛔ MAALT 19/9: uden (?<!-) aad scriptet sig selv. `\b` matcher OGSAA efter
    #    en bindestreg, saa "twenty-two tools" indeholder "two tools" - som blev
    #    til "twenty-five tools" og gav "twenty-twenty-five". Koer igen, og
    #    "five tools" rammer igen. Forsiden endte med at sige
    #    "Twenty-twenty-twenty-twenty-five tools" LIVE, lavet af det script der
    #    skulle forhindre praecis den slags.
    #
    #    (?<!-) siger: ordet maa ikke staa lige efter en bindestreg.
    for i, w in enumerate(ORD):
        if i == N: continue
        t = re.sub(r'(?<!-)\b%s tools\b' % w, '%s tools' % ORD[N], t, flags=re.I)
        t = re.sub(r'(?<!-)\b%s that look\b' % w, '%s that look' % ORD[L], t, flags=re.I)
        t = re.sub(r'(?<!-)\b%s look\b' % w, '%s look' % ORD[L], t, flags=re.I)
    for i, w in enumerate(ORD):
        if i == S: continue
        t = re.sub(r'(?<!-)\b%s write tools\b' % w, '%s write tools' % ORD[S], t, flags=re.I)
        t = re.sub(r'(?<!-)\b%s that touch\b' % w, '%s that touch' % ORD[S], t, flags=re.I)
        t = re.sub(r'(?<!-)\b%s touch\b' % w, '%s touch' % ORD[S], t, flags=re.I)

    if t != foer:
        io.open(p,'w',encoding='utf-8').write(t); i_alt += 1
        print('  ✓', f)
print('flader rettet: %d af %d' % (i_alt, len(FLADER)))
print()
print('⛔ Vagten bestemmer, ikke dette script. Koer nu: ./test/run-all.sh')
