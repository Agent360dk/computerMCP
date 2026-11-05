// Vault-portens adresse-regel som ren funktion - uden Chrome, uden tilgaengelighed.
//
// ⛔ R4/R5 (Opus R4-9, Astra): claims-offline tjekkede kun at strengene STOD i kilden; en mutant der fjernede
//    passwords.google.com fra listen overlevede alt. Her spoerges hjaelperen selv (`vault-url`) om hver adresse,
//    begge veje: hver post paa listen SKAL genkendes, og grænsetilfaeldene maa IKKE.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = process.env.CMCP_HELPER || join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
if (!existsSync(H)) { console.log('SPRUNGET OVER: 1 (ingen bygget hjaelper her) - bevist intet, ikke bestaaet'); process.exit(0); }
let fejl = 0, ok = 0;
const sp = (u) => JSON.parse(execFileSync(H, ['vault-url', '--url', u], { encoding: 'utf8' })).password_page;

const ER = [
  // browserens egne kodeordssider
  'chrome://password-manager/passwords', 'chrome://settings/passwords', 'edge://wallet/passwords',
  'edge://settings/passwords', 'edge://settings/autofill/passwords/checkup', 'brave://password-manager/passwords',
  'brave://settings/passwords', 'opera://settings/passwords', 'vivaldi://settings/passwords', 'vivaldi://password-manager/settings',
  'about:logins', 'about:logins?filter=x', 'extension://nngceckbapebfimnlniiiahkandclblb/popup/index.html',
  'chrome-extension://nngceckbapebfimnlniiiahkandclblb', 'https://keepersecurity.com/vault', 'https://passwords.google.com/intro-private',
  // web-hvaelv
  'https://my.1password.com/vaults', 'https://agent360.1password.eu/', 'https://start.1password.com/signin', 'https://team.1password.ca/',
  'https://vault.bitwarden.com/#/vault', 'https://vault.bitwarden.eu/', 'https://app.dashlane.com/', 'https://pass.proton.me/',
  'https://app.nordpass.com/', 'https://passwords.google.com/options', 'https://online.roboform.com/', 'https://passwords.avira.com/',
  'https://govcloud.keepersecurity.us/vault/', 'https://lastpass.com/vault/', 'https://www.lastpass.com/vault/', 'https://lastpass.eu/vault/',
  'https://keepersecurity.com/vault/', 'https://keepersecurity.eu/vault/', 'https://keepersecurity.com.au/vault/',
  'https://keepersecurity.ca/vault/', 'https://keepersecurity.jp/vault/',
  // R9 (Opus R7-O15): fuldt vaertsnavn med punktum til sidst og dobbelte skraastreger er samme side
  'https://vault.bitwarden.com./', 'https://passwords.google.com./', 'https://lastpass.com//vault/', 'https://keepersecurity.com///vault',
  // udvidelser (Chrome Web Store + Edge Add-ons, hver bekraeftet 5/11)
  ...['aeblfdkhhhdcdjpifhhbdiojplfjncoa', 'nngceckbapebfimnlniiiahkandclblb', 'hdokiejnpimakedhajhdlcegeplioahd',
      'fdjamakpfbbddfjaooikfcpapjohcfmg', 'ghmbeldphafepmbegfdlkpapadhbakde', 'bfogiafebfohielmmehodmfbbebbbpei',
      'fooolghllnmhmmndgjiamiiodkpenpbb', 'pnlccmojcmeohlpggmfnbbiapkmbliob', 'kmcfomidfpdkfieipokbalgegidffkal',
      'pejdijmoenmkgeppbflobdenhhabjlaj', 'admmjipmmciaobhojoghlmleefbicajg', 'caljgklbbfbcjjanaijlacgncafpegll',
      'eiaeiblijfjekdanodkjadfinkhbfgcd', 'jbkfoedolllekgbhcbcoahefnbanhhlh', 'dppgmdbiimibapkepcbdbmkaabgiofem',
      'bbcinlkgjjkejfdpemiealijmmooekmp', 'gehmmocbbkpblljhkekmfhjpfbkclbph', 'lfochlioelphaglamdcakfjemolpichk']
    .map((id) => `chrome-extension://${id}/popup/index.html`),
];
const ER_IKKE = [
  'https://1password.com/', 'https://www.1password.com/', 'https://support.1password.com/', 'https://blog.1password.com/x',
  'https://passwords.google.com/intro', 'https://lastpass.com/', 'https://lastpass.com/pricing', 'https://keepersecurity.com/',
  'https://bitwarden.com/', 'https://example.com/vault/', 'https://vault.bitwarden.com.example.com/', 'file:///Users/x/side.html',
  'chrome://settings/', 'chrome://newtab/', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html', 'about:blank',
  'https://www.google.com/search?q=1password', 'chrome://password-manager-ikke',
  'about:loginsx', 'extension://abcdefghijklmnopabcdefghijklmnop/x.html', 'moz-extension://nngceckbapebfimnlniiiahkandclblb/',
  // R6 (Astra): graenser efter id og sti
  'extension://nngceckbapebfimnlniiiahkandclblb.example/popup.html', 'https://keepersecurity.com/vaulting',
  'https://lastpass.com/vaultx/',
  // R9: normaliseringen udvider ikke reglen - velkomstsiden og en anden sti er stadig ikke hvaelvet
  'https://passwords.google.com./intro', 'https://lastpass.com//vaulting', 'https://bitwarden.com./',
];
for (const u of ER) { if (sp(u) === true) ok++; else { fejl++; console.log(`DUMP genkendes ikke: ${u}`); } }
for (const u of ER_IKKE) { if (sp(u) === false) ok++; else { fejl++; console.log(`DUMP genkendes forkert: ${u}`); } }
console.log(`${ok} OK af ${ER.length + ER_IKKE.length}`);
console.log(fejl ? `\n${fejl} DUMPET` : '\nBESTAAET');
process.exit(fejl ? 1 : 0);
