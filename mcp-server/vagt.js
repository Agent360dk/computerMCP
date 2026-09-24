// Foraeldre-vagten: doer chatten, doer serveren med.
//
// ⛔ ASTRA (23/9): «ingen foraeldre-vagt - servere lever videre naar chatten
//    lukkes». MAALT samme dag: 34 statusfiler mod 15 levende processer, og de
//    19 doede var chats der var lukket. Filerne ryddes op af `ryddDoede()`,
//    men en efterladt SERVER er vaerre end en efterladt fil: den staar med
//    tilgaengeligheds-rettigheder, den taeller med i «hvor mange agenter
//    koerer», og ingen kan laengere svare paa dens godkendelses-spoergsmaal.
//
// Den normale vej er at stdin lukker. Den vej daekker ikke en klient der bliver
// DRAEBT - saa lukker ingen noget - og det er praecis den vej der efterlod de
// nitten.
//
// ⛔ MAALT 23/9, og det aendrede vagten: `process.ppid` i Node er ikke et tal
//    laest ved opstart, men et opslag hver gang. Doer foraelderen, adopterer
//    launchd os, og `process.ppid` svarer **1** ved naeste opslag. Det er et
//    bedre signal end at spoerge om klientens pid stadig lever: et pid kan
//    genbruges af en helt anden proces, et foraelder-skift kan ikke.
//
// Vagten ser paa vores EGEN foraelder, ikke paa hele kaeden. Et led hoejere
// oppe kan skifte lovligt, og en vagt der draeber for meget er vaerre end en
// efterladt proces. Bliver vi startet gennem en skal der bliver staaende
// efter at klienten doer, fanger vagten det ikke - skrevet ned, ikke pakket ind.

/// true KUN naar processen beviseligt ikke findes.
///
/// ⛔ Soesterproduktets foerste udgave tolkede ENHVER undtagelse som «doed» og
///    lukkede levende chats ned fem sekunder efter opstart: pid 1 er launchd,
///    og `kill(1, 0)` kaster EPERM for en almindelig bruger. ESRCH er det
///    eneste svar der betyder doed. Ved tvivl draeber vi ikke.
export function ledErDoedt(pid, kill = process.kill.bind(process)) {
  try {
    kill(pid, 0);
    return false;
  } catch (e) {
    if (e?.code === 'ESRCH') return true;
    return false;         // EPERM = lever, ejet af en anden. Alt andet: tvivl.
  }
}

/// Er vi blevet foraeldreloese siden opstart?
export function erForaeldreloes(start, nuPpid, kill) {
  if (!start || start <= 1) return false;   // startet af launchd: ingen chat at doe med
  if (nuPpid() !== start) return true;      // adopteret - foraelderen er vaek
  return ledErDoedt(start, kill);           // faldbag hvis adoptionen ikke ses
}

/// Starter vagten. Returnerer en stop-funktion (proeverne bruger den).
export function startVagt({
  intervalMs = 30_000,
  start = process.ppid,
  nuPpid = () => process.ppid,
  kill = undefined,
  nuLuk = null,
  miljoe = process.env,
} = {}) {
  // ⛔ 24/9: hed foerst `CMCP_INGEN_VAGT` - et dansk navn paa en knap en
  //    fremmed kan faa brug for. Produktets sprog er engelsk. Paastand 27 fangede
  //    det paa sloeringens loft, ikke her; ordlisten kendte ikke «ingen vagt».
  if (miljoe.CMCP_NO_PARENT_WATCH === '1') return () => {};
  if (!start || start <= 1) return () => {};
  const luk = nuLuk || (() => {
    process.stderr.write('[computer-mcp] the client that started this server is gone; shutting down\n');
    process.exit(0);
  });
  const t = setInterval(() => { if (erForaeldreloes(start, nuPpid, kill)) luk(); }, intervalMs);
  t.unref?.();
  return () => clearInterval(t);
}
