import { execFile } from 'child_process';

/// Tre niveauer. Inddelingen er ikke kosmetisk - den afgoer hvad der kan ske
/// mens mennesket ikke kigger.
export const TIER = { READ: 'read', WRITE: 'write', DANGER: 'danger' };

/// Programmer hvor ENHVER handling spoerger, hver gang, uanset tilstand.
///
/// To slags: dem der opbevarer hemmeligheder, og dem hvor et tastetryk ER en
/// kommando. Et klik i en terminal er ikke et klik i en tekstbehandler - det
/// kan slette et helt hjemmebibliotek. Vores egen analyse fra juni pegede
/// praecis paa den vej: en prompt-indsproejtning under "research" der bliver
/// til en fysisk handling i et terminalvindue.
export const ALWAYS_ASK_APPS = new Set([
  'com.apple.keychainaccess', 'com.apple.Passwords',
  'com.agilebits.onepassword7', 'com.1password.1password',
  'com.bitwarden.desktop', 'com.lastpass.LastPass', 'com.dashlane.Dashlane',
  'com.apple.Terminal', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable',
  'co.zeit.hyper', 'net.kovidgoyal.kitty', 'io.alacritty'
]);

export const MODES = new Set(['readonly', 'ask', 'allow']);

export function currentMode() {
  const m = (process.env.CMCP_MODE || 'ask').toLowerCase();
  return MODES.has(m) ? m : 'ask';
}

/// Sessionens samtykke. Bevidst kun i hukommelsen: lukkes serveren, er
/// samtykket vaek. Et samtykke der overlever paa disken, er et samtykke
/// brugeren ikke kan huske at have givet.
let sessionGranted = false;
export function resetSession() { sessionGranted = false; }
export function isSessionGranted() { return sessionGranted; }

/// Spoerger mennesket med en aegte macOS-dialog.
///
/// Svarer ingen inden for tidsgraensen, er svaret NEJ. Det er den eneste
/// forsvarlige standard: en dialog der ender med "ja" fordi ingen saa den,
/// er ikke et samtykke - saa havde vi lige saa godt kunnet lade vaere at spoerge.
export function askTimeout() {
  const v = Number(process.env.CMCP_ASK_TIMEOUT);
  return Number.isFinite(v) && v > 0 ? v : 60;
}

export function askHuman(title, body, timeoutSec = askTimeout()) {
  return new Promise((resolve) => {
    const script = [
      'display dialog',
      JSON.stringify(body),
      'with title', JSON.stringify(title),
      'buttons {"Nej", "Ja"} default button "Nej"',
      `giving up after ${timeoutSec}`
    ].join(' ');
    execFile('/usr/bin/osascript', ['-e', script], { timeout: (timeoutSec + 10) * 1000 }, (err, stdout) => {
      if (err) return resolve(false);
      const out = String(stdout);
      if (/gave up:true/.test(out)) return resolve(false);
      resolve(/button returned:Ja/.test(out));
    });
  });
}

/// Afgoer hvad der skal ske med ét kald. Returnerer {allow, reason, asked}.
export async function decide({ tier, targetBundleId, describe }) {
  const mode = currentMode();

  if (tier === TIER.READ) return { allow: true, reason: 'laesning', asked: false };

  if (mode === 'readonly') {
    return {
      allow: false, asked: false,
      reason: 'CMCP_MODE=readonly: kun laesende vaerktoejer er tilladt. Saet CMCP_MODE=ask for at kunne styre maskinen.'
    };
  }

  const dangerousApp = targetBundleId && ALWAYS_ASK_APPS.has(targetBundleId);

  // Farlige programmer spoerger HVER gang - ogsaa i allow-tilstand, og ogsaa
  // selvom sessionen allerede har givet samtykke. Det er hele forskellen paa
  // "jeg gav agenten lov til at arbejde" og "jeg gav agenten min adgangskode".
  if (tier === TIER.DANGER || dangerousApp) {
    const ok = await askHuman(
      'Computer MCP',
      `${describe}\n\nDet sker i ${targetBundleId || 'et program'}, som altid spoerger.\n\nTillad denne ene handling?`
    );
    return { allow: ok, asked: true, reason: ok ? 'mennesket sagde ja' : 'mennesket sagde nej eller svarede ikke' };
  }

  if (mode === 'allow') return { allow: true, reason: 'CMCP_MODE=allow', asked: false };
  if (sessionGranted) return { allow: true, reason: 'sessionen har samtykke', asked: false };

  const ok = await askHuman(
    'Computer MCP',
    `En agent vil styre din Mac.\n\nFoerste handling: ${describe}\n\nSiger du ja, maa den klikke og skrive i resten af denne session. Adgangskodefelter sloeres altid, og programmer som 1Password og Terminal spoerger hver gang.\n\nGiv adgang for denne session?`
  );
  if (ok) sessionGranted = true;
  return { allow: ok, asked: true, reason: ok ? 'sessionen fik samtykke' : 'mennesket sagde nej eller svarede ikke' };
}
