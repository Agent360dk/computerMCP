#!/usr/bin/env python3
"""Tavlen - det instrument en forbedrings-sloejfe maaler sig mod.

Model-fri, laese-kun, ingen afhaengigheder ud over urllib. Det er med vilje:
en sloejfe hvor agenter foreslaar og en MODEL doemmer, doemmer sig selv. Det her
kan sige nej til en agent, fordi det ikke er en agent.

⛔ HVORFOR DEN FINDES (21/9-2026)
   Paa én dag producerede fem agent-koersler hver for sig fund der delvist var
   forkerte: registrer-agenten rettede sig selv to gange og fik sin vigtigste
   anbefaling falsificeret; begge konsulenter tog fejl om Smitherys backlinkUrl;
   et review placerede en saetning paa sitet som stod i README'en. Og fire af
   mine EGNE maalinger var falske indtil de blev gentaget.

   Vaerdien laa aldrig i at generere. Den laa i at efterproeve. En sloejfe uden
   et instrument der kan sige nej, ganger fejlene op i stedet for ned.

⛔ HVAD DEN IKKE GOER
   Den handler ikke. Den sender ingen PR'er, indsender intet, skriver intet
   offentligt. Den maaler, og den siger hvad der er usandt om os lige nu.

Koer:  python3 scripts/tavle.py            (tabel)
       python3 scripts/tavle.py --json     (til en sloejfe)
"""
import json, os, re, subprocess, sys, urllib.error, urllib.request

UA = {"User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/140.0 Safari/537.36"),
      "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"}
ROD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def hent(url, som_json=False, timeout=25):
    """Returnerer (data, fejl). En fejl er ALDRIG en nul-vaerdi - den er None,
    saa et opslag der ikke kunne naas aldrig laeses som 'vi har nul'."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            raa = r.read().decode("utf-8", "replace")
        return (json.loads(raa) if som_json else raa), None
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def kildeversion():
    with open(os.path.join(ROD, "mcp-server", "package.json")) as f:
        return json.load(f)["version"]


def vaerktoejstal():
    """Talt i kilden, ikke i en tekst. Et tal i en overskrift er en paastand."""
    ud = subprocess.run(
        ["node", "--input-type=module", "-e",
         "const t=await import('./mcp-server/tools.js');const a=Object.values(t.TOOLS||t.default);"
         "console.log(JSON.stringify({alle:a.length,laes:a.filter(x=>x.tier==='read').length}))"],
        cwd=ROD, capture_output=True, text=True, timeout=120)
    try:
        return json.loads(ud.stdout.strip().splitlines()[-1])
    except Exception:
        return {"alle": None, "laes": None}


def proevedaekning():
    """Hvor mange af vaerktoejerne roeres af mindst én proeve."""
    t = vaerktoejstal()
    ud = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import{readFileSync,readdirSync}from'fs';"
         "const t=await import('./mcp-server/tools.js');const a=Object.values(t.TOOLS||t.default);"
         "const alt=readdirSync('test').filter(f=>/\\.(mjs|py|sh)$/.test(f))"
         ".map(f=>readFileSync('test/'+f,'utf8')).join('\\n');"
         "console.log(JSON.stringify({roert:a.filter(x=>alt.includes(x.name)).length,"
         "urort:a.filter(x=>!alt.includes(x.name)).map(x=>x.name)}))"],
        cwd=ROD, capture_output=True, text=True, timeout=120)
    try:
        d = json.loads(ud.stdout.strip().splitlines()[-1])
        d["af"] = t["alle"]
        return d
    except Exception:
        return {"roert": None, "af": t["alle"], "urort": []}


# ---- 1. UDBREDELSE ----------------------------------------------------------
def udbredelse():
    ud = {}
    for navn, sti in [("uge", "last-week"), ("maaned", "last-month")]:
        d, _ = hent(f"https://api.npmjs.org/downloads/point/{sti}/@agent360/computer-mcp", True)
        ud[f"npm_{navn}"] = d.get("downloads") if d else None
    d, _ = hent("https://api.github.com/repos/Agent360dk/computerMCP", True)
    ud["stjerner"] = d.get("stargazers_count") if d else None
    ud["forks"] = d.get("forks_count") if d else None
    return ud


# ---- 2. ER KANALERNE I TAKT? ------------------------------------------------
def i_takt():
    kilde = kildeversion()
    d, _ = hent("https://registry.npmjs.org/@agent360%2Fcomputer-mcp", True)
    npm = (d or {}).get("dist-tags", {}).get("latest")
    d2, _ = hent("https://registry.modelcontextprotocol.io/v0/servers?search=computer-mcp&limit=50", True)
    reg = None
    for e in (d2 or {}).get("servers", []):
        s = e.get("server", {})
        m = e.get("_meta", {}).get("io.modelcontextprotocol.registry/official", {})
        if s.get("name", "").endswith("/computer-mcp") and m.get("isLatest"):
            reg = s.get("version")
    return {"kilde": kilde, "npm": npm, "register": reg,
            "i_takt": bool(npm and reg and npm == kilde == reg)}


# ---- 3. HVOR STAAR VI, OG SIGER DE SANDT OM OS? -----------------------------
# Indholds-tjek, ikke HTTP-status. En 200 fra en fejlside er ikke en listning.
KATALOGER = [
    ("officielt register", "https://registry.modelcontextprotocol.io/v0/servers?search=computer-mcp&limit=50"),
    ("Glama",              "https://glama.ai/mcp/servers/Agent360dk/computerMCP"),
    ("Smithery",           "https://smithery.ai/server/gustav/computer-mcp"),
    ("punkpeye awesome",   "https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md"),
    ("mcp.so",             "https://mcp.so/servers/computer-mcp"),
]


def naer_os(tekst, vindue=700):
    """⛔ KALIBRERET 21/9: foerste udgave scannede HELE siden og talte andre
    servers tal med - Glama viste «72 tools» om en fremmed server, og tavlen
    meldte det som en usandhed om os. En vagt der raaber ulv er naesten lige
    saa slem som en der tier. Nu ses kun tekst taet paa vores eget navn."""
    ud = []
    for m in re.finditer(r"computer-?mcp|Agent360dk", tekst or "", re.I):
        ud.append((tekst or "")[max(0, m.start() - vindue): m.end() + vindue])
    return "\n".join(ud) if ud else ""


def usandt_om_os(tekst, vt, udgivet_antal=None):
    """Bygget paa tal og HELE vendinger, aldrig paa ordstumper.
    «0 dage» findes i «90 dages karantaene» - den fejl er begaaet her i huset.

    ⛔ KALIBRERET 21/9: et katalog der siger «12 tools» tager ikke fejl - det
    beskriver den version npm FAKTISK serverer. Det bliver foerst forkert naar
    vi udgiver. Derfor accepteres baade kildens tal og det udgivne tal, og
    resten meldes som «tal vi ikke kan genkende», ikke som en loegn."""
    fejl = []
    naer = naer_os(tekst)
    ok = {x for x in (vt.get("alle"), udgivet_antal) if x}
    for m in re.findall(r"\b(\d{1,3}) tools\b", naer):
        if ok and int(m) not in ok:
            fejl.append(f"ukendt vaerktoejstal: {m} (kilden {vt['alle']}"
                        + (f", udgivet {udgivet_antal}" if udgivet_antal else "") + ")")
    for vending, hvorfor in [
        ("local-only", "falsk: det agenten laeser gaar videre til AI-klienten"),
        ("consent gate on every write", "falsk siden 21/9: standarden spoerger ikke"),
        ("read-only until you say otherwise", "falsk siden 21/9"),
    ]:
        if vending.lower() in naer.lower():
            fejl.append(f"«{vending}» - {hvorfor}")
    return sorted(set(fejl))


def kataloger(vt, udgivet=None):
    ud = []
    for navn, url in KATALOGER:
        tekst, fejl = hent(url)
        if tekst is None:
            ud.append({"katalog": navn, "staar_der": None, "fejl": fejl, "usandt": []})
            continue
        staar = bool(re.search(r"computer-?mcp", tekst, re.I) and re.search(r"agent360", tekst, re.I))
        ud.append({"katalog": navn, "staar_der": staar, "fejl": None,
                   "usandt": usandt_om_os(tekst, vt, udgivet) if staar else []})
    return ud


# ---- 4. KONKURRENTERNE ------------------------------------------------------
# Vaerktoejstallet i den version npm FAKTISK serverer. Et katalog der
# gengiver det, tager ikke fejl. Rettes naar en ny version udgives.
UDGIVET_ANTAL = 12

# ⛔ 21/9: steipete/peekaboo svarer 301 -> openclaw/Peekaboo. Et repo-navn er
#    ikke en konstant. Tavlen fulgte omdirigeringen i tavshed og viste et
#    rigtigt tal under et doedt navn.
KONKURRENTER = ["openclaw/Peekaboo", "mediar-ai/terminator", "CursorTouch/Windows-MCP",
                "lahfir/agent-desktop", "TurixAI/TuriX-CUA"]


def konkurrenter():
    ud = []
    for r in KONKURRENTER:
        d, _ = hent(f"https://api.github.com/repos/{r}", True)
        ud.append({"repo": r,
                   "stjerner": d.get("stargazers_count") if d else None,
                   "sidste_push": (d.get("pushed_at") or "")[:10] if d else None})
    return ud


def main():
    vt = vaerktoejstal()
    t = {"vaerktoejer": vt, "udbredelse": udbredelse(), "takt": i_takt(),
         "kataloger": kataloger(vt, UDGIVET_ANTAL), "proever": proevedaekning(),
         "konkurrenter": konkurrenter()}

    if "--json" in sys.argv:
        print(json.dumps(t, indent=2, ensure_ascii=False))
        return 0

    u, k, p = t["udbredelse"], t["takt"], t["proever"]
    print(f"\nTAVLEN - computer-mcp\n{'=' * 66}")
    print(f"  udbredelse   npm {u['npm_uge']}/uge · {u['npm_maaned']}/md · "
          f"{u['stjerner']} stjerner · {u['forks']} forks")
    print(f"  i takt       kilde {k['kilde']} · npm {k['npm']} · register {k['register']}"
          f"   {'JA' if k['i_takt'] else 'NEJ'}")
    print(f"  proever      {p['roert']} af {p['af']} vaerktoejer roert"
          + (f"   urort: {', '.join(p['urort'])}" if p["urort"] else ""))
    print("\n  kataloger")
    for c in t["kataloger"]:
        stand = "?" if c["staar_der"] is None else ("staar der" if c["staar_der"] else "IKKE der")
        print(f"    {c['katalog']:22} {stand}" + (f"   ({c['fejl'][:38]})" if c["fejl"] else ""))
        for f in c["usandt"]:
            print(f"      uenig: {f}")
    print("\n  konkurrenter")
    for c in t["konkurrenter"]:
        print(f"    {c['repo']:28} {c['stjerner']} stjerner · sidst {c['sidste_push']}")
    usande = sum(len(c["usandt"]) for c in t["kataloger"])
    mangler = sum(1 for c in t["kataloger"] if c["staar_der"] is False)
    print(f"\n  {'-' * 62}")
    print(f"  uenigheder om os i det offentlige:       {usande}")
    print(f"  kataloger vi mangler:                    {mangler}")
    print(f"  kanalerne i takt:                        {'ja' if k['i_takt'] else 'NEJ'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
