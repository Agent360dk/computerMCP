// Hver proeve der starter serveren, faar sin EGEN tilstandsmappe - ogsaa koert alene.
//
// ⛔ 7/10 (panel R8-R9, punkt F): en serverstart uden CMCP_STATE_DIR skriver i
//    menneskets rigtige revisionslog, koe og samtykke (~/.local/state/computer-mcp).
//    Hver fil satte den selv - men en glemt start, eller en proeve der SLETTEDE
//    variablen undervejs (claims 34), ville ramme den rigtige. Importeres foerst;
//    `test/tilstand-isoleret.mjs` kraever importen i hver fil der starter serveren.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
if (!process.env.CMCP_STATE_DIR) process.env.CMCP_STATE_DIR = mkdtempSync(join(tmpdir(), 'cmcp-proeve-tilstand-'));
// 7/10: og ingen proeve starter eller spoerger menneskets rigtige menulinje-ikon, naar
// den koeres alene (run-all.sh goer det samme). Proever der maaler ikonet, saetter selv
// CMCP_STATUS_IKON og bruger et falsk ikon i deres egen mappe. Fundet: sessionsport
// koert alene sendte sine spoergsmaal til menulinjen i stedet for proevens attrap.
if (process.env.CMCP_STATUS_IKON === undefined) process.env.CMCP_STATUS_IKON = '0';
export const PROEVE_TILSTAND = process.env.CMCP_STATE_DIR;
