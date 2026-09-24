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
import io, json, json, os, re, subprocess, sys, glob

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

# ⛔ FUNDET AF RAADGIVEREN 20/9: listen var HAANDHOLDT - tolv filer, mens docs/
#    havde syvogtyve. Fire levende sider sagde "All 18 tools" eller "All 22
#    tools", og npm's egen side sagde 22. Scriptet rettede pligtskyldigt de tolv
#    og meldte "12 af 12", og vagten sagde "alle siger 27". Begge var sande om
#    det de kiggede paa.
#
#    En liste nogen skal huske at udvide, ER hullet. Fladerne findes nu.
FLADER = ['README.md', 'mcp-server/README.md']
for _sti in sorted(glob.glob(ROD + '/docs/**/*', recursive=True)):
    if _sti.rsplit('.', 1)[-1] in ('html', 'md', 'txt'):
        FLADER.append(_sti[len(ROD)+1:])


# ⛔ MAALT 20/9: erstatningen tabte store bogstaver. "Twelve tools" i begyndelsen
#    af en saetning blev til "twenty-seven tools" - rigtigt tal, forkert sprog,
#    og et lille tegn paa at teksten er maskinskrevet. Bevar formen paa det ord
#    der stod der.
def _som_original(fundet, nyt):
    return nyt[0].upper() + nyt[1:] if fundet[:1].isupper() else nyt

def _erstat(t, moenster, nyt_ord, hale):
    return re.sub(moenster,
                  lambda m: _som_original(m.group(1), nyt_ord) + hale,
                  t, flags=re.I)

def er_versionsforbehold(t, i):
    # "0.1.0, which has 12 tools" er med RETTE et andet tal.
    return '0.1.0' in t[max(0, i-90):i+20]

# ⛔ TREDJE FORMULERING DER SLAP FORBI 19/9: forbeholdet paa install-siderne
#    sagde "The source in the repository has 22" mens koden havde 25. Foerst
#    var det "N tools", saa "The N on this page", nu det her. At jagte
#    formuleringer er en tabt kamp - saa hele blokken GENERERES i stedet.
#    Een kilde, seks visninger.
FORBEHOLD = """<div class="box warn">
<p><b>What you get today, honestly.</b> <code>npx</code> currently serves
<b>0.1.0</b>, which has 12 tools. The code in the repository has {n}: menu bar
access, window control, moving windows between screens, pasting, opening and
quitting apps, waiting for something to appear, writing into a field behind
another window, and asking you for a password without the model ever seeing it.
Those ship with {v}, which is built and tested but not published yet.</p>
<p>Everything else on this page works with what you install today. If you want
all of them now, <a href="https://github.com/Agent360dk/computerMCP">build from
source</a>: about thirty-five seconds, and nothing to download.</p>
</div>"""

# FORBEHOLDET SKAL FORSVINDE AF SIG SELV NAAR DER UDGIVES.
#    Raadgiveren fandt 20/9 at udgivelsen ville sende sit EGET "ikke paa npm
#    endnu"-forbehold med ud - og en npm-README er FROSSET pr. version, saa
#    saetningen ville staa i 0.2.0 for evigt og kraeve en 0.2.1 at fjerne.
#    Derfor: PUBLICERET indeholder den version npx faktisk serverer.
#    release.sh skriver den efter en LYKKET udgivelse. Er den lig med pakkens
#    version, er der ingen afstand, og forbeholdet fjernes.
UDGIVET = 'ukendt'
_pv = os.path.join(ROD, 'PUBLICERET')
if os.path.exists(_pv):
    UDGIVET = io.open(_pv, encoding='utf-8').read().strip()
NUVAERENDE = json.load(io.open(os.path.join(ROD, 'mcp-server/package.json'), encoding='utf-8'))['version']
AFSTAND = UDGIVET != NUVAERENDE

for f in sorted(x[len(ROD)+1:] for x in glob.glob(ROD+'/docs/docs/install-*/index.html')):
    p2 = os.path.join(ROD, f)
    t2 = io.open(p2, encoding='utf-8').read()
    # ⛔ Foerste udgave var ENVEJS: den kunne fjerne forbeholdet, men ikke
    #    saette det tilbage - naar blokken var vaek, matchede regexen ingenting.
    #    En mekanik der kun kan den ene vej, er ikke en mekanik; den er en
    #    engangsoprydning. Derfor baade fjerne OG indsaette, med et fast anker.
    MOENSTER = r'<div class="box warn">\s*\n<p><b>What you get today.*?</div>\n?'
    har = re.search(MOENSTER, t2, flags=re.S) is not None
    ny, hvad = t2, None
    if AFSTAND and har:
        ny = re.sub(MOENSTER, FORBEHOLD.format(n=N, v=NUVAERENDE), t2, count=1, flags=re.S); hvad = 'genskrevet'
    elif AFSTAND and not har:
        ANKER = '<h2>The whole thing, in three steps</h2>'
        if ANKER in t2:
            # ⛔ Rundturen skal vaere IDENTISK. Foerste udgave lagde en tom
            #    linje til hver gang, saa en koersel der ikke aendrede noget,
            #    efterlod seks filer "aendrede". Stoej man ikke kan skelne fra
            #    sit eget arbejde, er dyrere end den ser ud.
            # ⛔ MAALT 23/9: her stod `+ '\n' +`, og OMSKRIVNINGS-vejen ovenfor
            #    aeder linjeskiftet (moenstret slutter paa `</div>\n?`). De to
            #    veje var altsaa uenige om én byte: indsaet gav `</div>\n<h2>`,
            #    omskriv gav `</div><h2>`. En tom udgivelses-toerkoersel efterlod
            #    derfor SEKS filer "aendrede" uden at have aendret noget, og jeg
            #    naaede at laese det som efterladt rod fra en anden chat to gange
            #    paa én dag. Kommentaren fire linjer oppe kraever at rundturen er
            #    identisk; det var den ikke.
            #    Bevis: fjern blokken fra én fil, koer scriptet EEN gang,
            #    `git diff` skal vaere tom. Foer rettelsen var den det ikke.
            ny = t2.replace(ANKER, FORBEHOLD.format(n=N, v=NUVAERENDE) + ANKER, 1); hvad = 'sat ind igen'
        else:
            print('  ⚠ ingen plads til forbeholdet i', f, '- saet det ind i haanden')
    elif not AFSTAND and har:
        ny = re.sub(MOENSTER + r'\n?', '', t2, count=1, flags=re.S); hvad = 'FJERNET (udgivet == kilden)'
    if hvad and ny != t2:
        io.open(p2,'w',encoding='utf-8').write(ny)
        print('  forbeholdet ' + hvad + ': ' + f)

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
    # ⛔ FJERDE FORMULERING DER SLAP FORBI - MAALT 23/9.
    #    Foerst «N tools», saa «The N on this page», saa «The source has N»,
    #    og nu «Only the N read tools». Den stod paa SYV flader og sagde 9,
    #    mens koden har 12 - i praecis den saetning der beskriver den tilstand
    #    dokumentationen selv siger man skal STARTE i. En fremmed traf altsaa
    #    sit foerste valg paa et forkert tal.
    #    MAALT: en server med CMCP_MODE=readonly lister 12 vaerktoejer.
    #    Paastand 47 fanger den naeste formulering; det her retter den.
    t = re.sub(r'\b(\d+) read tools\b', '%d read tools' % L, t)
    t = re.sub(r'\b(\d+) reading tools\b', '%d reading tools' % L, t)

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
        t = _erstat(t, r'(?<!-)\b(%s) tools\b' % w, ORD[N], ' tools')
        t = _erstat(t, r'(?<!-)\b(%s) that look\b' % w, ORD[L], ' that look')
        t = _erstat(t, r'(?<!-)\b(%s) look\b' % w, ORD[L], ' look')
        t = _erstat(t, r'(?<!-)\b(%s) read tools\b' % w, ORD[L], ' read tools')
        t = _erstat(t, r'(?<!-)\b(%s) reading tools\b' % w, ORD[L], ' reading tools')
    for i, w in enumerate(ORD):
        if i == S: continue
        t = _erstat(t, r'(?<!-)\b(%s) write tools\b' % w, ORD[S], ' write tools')
        t = _erstat(t, r'(?<!-)\b(%s) that touch\b' % w, ORD[S], ' that touch')
        t = _erstat(t, r'(?<!-)\b(%s) touch\b' % w, ORD[S], ' touch')

    if t != foer:
        io.open(p,'w',encoding='utf-8').write(t); i_alt += 1
        print('  ✓', f)
# ⛔ Forbeholdene stod i FEM forskellige formuleringer paa fem flader, og hver
#    af dem ville blive usand i samme sekund der udgives - npm-README'en endda
#    FROSSET for evigt. Man kan ikke jage formuleringer; derfor er de MARKERET.
#    Er der ingen afstand mellem udgivet og kilde, fjernes blokken - uanset
#    hvad der staar i den.
import re as _re
# ⛔ Teksterne GENERERES, de gemmes ikke. Foer i dag stod de i fem forskellige
#    formuleringer, og en toerkoersel 20/9 viste hvorfor det er farligt: da
#    blokken blev fjernet, var der intet at saette tilbage, og en fejlet
#    udgivelse ville permanent stryge fem forbehold.
#
#    Nu er der én kilde (udgivet, kilden, N) og fem visninger. Tomme markoerer
#    fyldes; er der ingen afstand, toemmes de igen.
def _forbehold(fil, udgivet, n):
    lang = (f'`npx @agent360/computer-mcp` currently serves **{udgivet}**, which has 12 tools. '
            f'The {n} tools described here are the source: they are built and tested, but not published yet. '
            f'Building from source takes about thirty-five seconds if you want them now.')
    if fil.endswith('.html'):
        return ('<div class="box warn"><p><b>What you get today, honestly.</b> '
                + lang.replace('`', '<code>').replace('**', '<b>', 1).replace('**', '</b>', 1)
                      .replace('<code>npx @agent360/computer-mcp<code>', '<code>npx @agent360/computer-mcp</code>')
                + '</p></div>')
    if fil.endswith('.txt'):
        return (f'VERSION: npx serves {udgivet}, which has 12 tools. The {n} tools described below\n'
                f'the source: they are built and tested but not published yet. Do not tell a user\n'
                f'that a tool is available after an npx install unless it is one of the twelve.')
    return '> **What you get today, honestly.** ' + lang

MARKERET = ['docs/index.html', 'docs/tools.html', 'README.md',
            'docs/llms.txt', 'docs/llms-install.md']
for f in MARKERET:
    p3 = os.path.join(ROD, f)
    if not os.path.exists(p3): continue
    t3 = io.open(p3, encoding='utf-8').read()
    m3 = _re.search(r'(<!-- FORBEHOLD -->|# FORBEHOLD).*?(<!-- /FORBEHOLD -->|# /FORBEHOLD)\n?',
                    t3, flags=_re.S)
    if not m3:
        if AFSTAND: print('  ⚠ forbeholdet mangler i', f, '- npx serverer stadig', UDGIVET)
        continue
    aaben, luk = m3.group(1), m3.group(2)
    # ⛔ Foerste udgave regnede i TEGN: start+len(aaben) til end-len(luk).
    #    Moenstret slutter med et valgfrit linjeskift, saa `end-len(luk)`
    #    landede INDE i slutmarkoeren - indholdet saa aldrig tomt ud, og
    #    genudfyldningen fyrede aldrig. Gruppernes egne positioner er
    #    praecise; min hovedregning var det ikke.
    indhold = t3[m3.end(1):m3.start(2)].strip()
    if AFSTAND:
        # ⛔ Foerste udgave fyldte kun TOMME markoerer. Stod der allerede en
        #    tekst, skete der intet - saa en rettet generator naaede ALDRIG ud,
        #    og teksten frøs fast i den form den havde den dag den blev skrevet.
        #    Maalt: jeg rettede generatoren til at sige "28 tools" i stedet for
        #    "28", koerte scriptet, og README stod uaendret - hvorefter
        #    udgivelsens egen port stoppede paa den.
        #
        #    Generatoren er kilden. Teksten skrives derfor ALTID om, ikke kun
        #    naar den mangler.
        # ⛔ Rundturen skal vaere IDENTISK. Foerste udgave lagde en tom linje
        #    til hver gang - en drift der voksede ved hvert udgivelsesforsoeg,
        #    og som efterlod seks filer "aendrede" efter en koersel der ikke
        #    aendrede noget. En mekanik der ikke kan koeres to gange uden
        #    forskel, er ikke idempotent - og saa kan man ikke se hvad der er
        #    ens arbejde og hvad der er scriptets stoej.
        hale = '\n' if t3[m3.end():].startswith('\n') else '\n\n'
        ny3 = (t3[:m3.start()] + aaben + '\n' + _forbehold(f, UDGIVET, N) + '\n'
               + luk + hale.rstrip('\n') + t3[m3.end():])
        if ny3 != t3:
            io.open(p3,'w',encoding='utf-8').write(ny3)
            print(('  forbeholdet sat ind igen: ' if not indhold else '  forbeholdet skrevet om: ') + f)
        continue
    if not AFSTAND:
        # ⛔ FUNDET I EN TOERKOERSEL 20/9: her stod en FJERNELSE, og den var
        #    envejs - markoererne forsvandt sammen med teksten, saa der var
        #    intet at finde naeste gang. En fejlet udgivelse ville dermed
        #    PERMANENT stryge fem forbehold, og faldbaggen kunne ikke rulle
        #    dem tilbage. Praecis samme fejl som install-siderne havde, men
        #    jeg rettede kun den ene af de to steder.
        #
        #    Markoererne bliver staaende, tomme. Saa kan teksten komme igen.
        aaben = m3.group(1)
        luk = m3.group(2)
        io.open(p3,'w',encoding='utf-8').write(t3[:m3.start()] + aaben + '\n' + luk + '\n' + t3[m3.end():])
        print('  forbeholdet toemt (udgivet == kilden):', f)

print('flader rettet: %d af %d' % (i_alt, len(FLADER)))
print()
print('⛔ Vagten bestemmer, ikke dette script. Koer nu: ./test/run-all.sh')

# ⛔ MAALT 23/9: EN TOERKOERSEL STRIPPEDE DET AERLIGE FORBEHOLD FRA npm-TEKSTEN.
#
#    ⛔ OG MIN FOERSTE RETTELSE STOD DET FORKERTE STED. Den laa FOER
#    MARKERET-loekken, altsaa foer forbeholdet blev fyldt tilbage i README.md -
#    saa den udledte npm-teksten fra en README der endnu ikke var rettet, og
#    hullet var praecis lige saa stort. Paastand 45 fangede det i naeste
#    suite-koersel. Derfor staar den HER, sidst, efter alt andet er paa plads.
#
#    `release.sh` saetter PUBLICERET til den version der udgives FOER der bygges,
#    saa forbeholdet forsvinder fra alle flader. Fejler noget - eller er det bare
#    en `--tjek`-koersel - ruller faelden PUBLICERET tilbage og koerer DETTE
#    script igen. Men npm-READMEen blev kun udledt inde i `build-release.sh`,
#    som ikke koerer igen. Resultatet: `mcp-server/README.md` stod uden
#    forbeholdet, og det er praecis den fil npm viser - FROSSET pr. version.
#
#    Scriptet her redigerer i forvejen den fil (den staar i FLADER). Saa
#    udledningen hoerer her, foer tallene rettes. `build-release.sh` goer det
#    samme et oejeblik senere; det skader ikke, og paastand 45 vogter resultatet.
_rep = io.open(os.path.join(ROD, 'README.md'), encoding='utf-8').read()
_npm = re.sub(r'<img src="docs/[^>]*>\n\n', '', _rep, count=1)
_npm = _npm.replace('](docs/', '](https://github.com/Agent360dk/computerMCP/blob/main/docs/')
_npmsti = os.path.join(ROD, 'mcp-server/README.md')
if io.open(_npmsti, encoding='utf-8').read() != _npm:
    io.open(_npmsti, 'w', encoding='utf-8').write(_npm)
    print('  npm-READMEen udledt paa ny af repoets')
