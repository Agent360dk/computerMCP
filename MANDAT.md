# Mandat

**Computer MCP skal dominere computer use i verden.**

Gustav har sagt det tre gange på én dag: *«målet er verdens klasse no. 1
computermcp i verden»* · *«verdens dominerende på alle mcp registre, Google
mv.»* · *«husk dit job er at dominere computer mcp i verden»*.

Det er sporets mandat. Ikke baggrund, ikke dev-troværdighed alene.

## Retningen, sagt lige så mange gange

> *«Den skal jo kunne være som et menneske, ikke readonly»* · *«den skal køre
> autonomt og kunne alt eller mere end browsermcp»* · *«det skal køre i
> baggrunden, kunne det samme som browsermcp bare på tværs af computeren,
> og ikke disturbe»*

**Tre krav, og de er ikke i konflikt.** Det tog en dag at forstå, og fejlen var
min: jeg stillede «autonom» og «baggrund» op som to ender af samme skala.

- **autonom** = handler uden at spørge om lov hver gang
- **baggrund** = handler uden at tage skærmen
- **fuld** = kan det samme som browser-mcp, men på hele maskinen

Det der gjorde dem til modsætninger var at «tager skærmen» blev afgjort af
værktøjets NAVN. Det er leveringskanalen der tager skærmen, ikke navnet. En
hændelse i den globale strøm lander i det vindue mennesket bruger; den samme
hændelse i ét programs egen kø gør ikke.

**Målt 22/9:** 20 af 28 værktøjer tilbydes i baggrund, otte af dem skrivende.
Før den indsigt: 15 og tre. browser-mcp har 40 værktøjer på én flade (Chrome);
vi har 28 på hele maskinen. Pariteten er ikke nået, og tallet skal stå her
indtil den er.

**Den regel der ikke forhandles:** Gustav har sagt «tag aldrig skærmen» fire
gange. Et værktøj der ikke kan gøres stille, tilbydes ikke i baggrund - det
skjules, og den der vil have det slår baggrund fra selv.

## Historikken, så ingen genåbner den uden at kende den

21/9-2026 anbefalede en rådgiver at fryse sporet i syv dage. Argumentet var
målt og godt:

- `agent360-ide`, platformen der leder det hele, havde ikke fået én commit
  siden **28. juli**. computer-mcp fik **125 på syv dage**.
- «Nr. 1» er et **rang-mål**. Alle andre Agent360-mål er udfald — kroner,
  brugere, virksomheder — og har derfor et stoppested. Et rang-mål har ingen
  måling der siger «færdig, videre».
- Portefølje-noten fra 15/6 kaldte projektet «Idé/ny» med linjen *«Afgræns før
  byg»*. Det blev bygget fra bunden alligevel.

**Gustav har set de tal og valgt anderledes.** Argumentet er ikke forkert; det
er overhørt med vilje af den der ejer prioriteringen. Denne fil findes så
ingen — heller ikke en agent med gode intentioner — fryser sporet på
rådgiverens vegne.

## Hvad domination konkret måles på

`scripts/tavle.py`, kørt før og efter hver ændring:

| Tal | Hvor det stod 21/9 |
|---|---|
| npm-hentninger pr. uge | 159 nogensinde, 0 i går |
| Stjerner | 1 (Gustavs egen) |
| Kanalerne i takt (kilde = npm = register) | **nej** |
| Kataloger vi står i, og som siger sandt om os | 4 af 5 |
| Prøvedækning | 28 af 28 |
| Peekaboo, til sammenligning | 5.190 stjerner |

## Hvad der IKKE ændrer sig, uanset mandatet

Sandhed er ikke en stilart, den er en forudsætning. 21/9 blev **ni usande
offentlige påstande** fjernet på én dag; de fleste var vores egne. Et produkt
der lover noget det ikke gør, dominerer ingenting — det bliver bare fundet.

- Hver påstand på hver flade skal kunne køres.
- Hver vagt skal kunne blive **rød**. En grøn påstand tæller ikke før nogen
  har set den fejle og komme tilbage.
- Tavlen kører før og efter. Et tal der ikke flyttede sig, siges højt.

## Hvad der kræver Gustavs ord

Penge · offentlige indsendelser og opslag i hans navn · alt der ændrer den
leverede standard · adgange der rækker ud over det ene projekt.

## Den strategiske grund sporet også tjener

browser-mcp styrer Chrome. Denne styrer macOS. Ingen af dem kan
**overdragelsen** — en opgave der starter i browseren og slutter i et native
program. Det er også den OS-flade Agent360's non-dev-tilstand får brug for,
når en medarbejder der ikke skriver kode skal have agenten til at røre de
programmer der ikke har et API.
