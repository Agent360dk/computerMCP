import { TIER } from './policy.js';

/// Vaerktoejerne. Hvert enkelt baerer sit niveau, saa inddelingen ikke kan
/// glide fra hinanden: der findes ikke et vaerktoej uden et niveau.
///
/// Bemaerk hvad der IKKE er her: der er ingen "koer en kommando", ingen
/// "aabn en vilkaarlig fil", ingen "hent en URL". En computerstyrings-server
/// med en skal indenbords er en fjernadgang med et venligt navn. Vil man
/// have en skal, findes der servere til det - og saa har man valgt det selv.
export const TOOLS = [
  {
    name: 'computer_permissions',
    tier: TIER.READ,
    description: 'Check which macOS permissions are granted (Accessibility, Screen Recording). Call this first if anything fails.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'computer_apps',
    tier: TIER.READ,
    description: 'List running applications with their bundle IDs. Use the bundle ID to target other tools.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'computer_windows',
    tier: TIER.READ,
    description: 'List open windows with titles and screen frames.',
    inputSchema: {
      type: 'object',
      properties: { app: { type: 'string', description: 'Limit to one bundle ID or app name.' } }
    }
  },
  {
    name: 'computer_screenshot',
    tier: TIER.READ,
    description: 'Screenshot the screen or one app. Password fields and password-manager windows are blacked out BEFORE the image is written, so they never reach the model. Set redact=false only if you know the screen holds no secrets.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Bundle ID or app name. Omit for the whole screen.' },
        redact: { type: 'boolean', description: 'Default true. Blacks out secure fields.' },
        maxWidth: { type: 'number', description: 'Scale down to this width in pixels. Default 1400.' }
      }
    }
  },
  {
    name: 'computer_inspect',
    tier: TIER.READ,
    description: 'Read the accessibility tree: roles, titles, values and frames. Prefer this over guessing pixel coordinates from a screenshot. Values of secure fields are never returned.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string' },
        depth: { type: 'number', description: 'Default 12.' },
        limit: { type: 'number', description: 'Max nodes, default 400.' }
      }
    }
  },
  {
    name: 'computer_audit',
    tier: TIER.READ,
    description: 'Show what this server has done: the last N entries of the append-only audit log.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Default 40.' } } }
  },
  {
    name: 'computer_click',
    tier: TIER.WRITE,
    description: 'Click at screen coordinates. Get coordinates from computer_inspect frames, not from guessing.',
    inputSchema: {
      type: 'object',
      required: ['x', 'y'],
      properties: {
        x: { type: 'number' }, y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        count: { type: 'number', description: '2 for double-click.' }
      }
    }
  },
  {
    name: 'computer_move',
    tier: TIER.WRITE,
    description: 'Move the mouse pointer without clicking (to trigger hover states).',
    inputSchema: { type: 'object', required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } } }
  },
  {
    name: 'computer_scroll',
    tier: TIER.WRITE,
    description: 'Scroll by pixel deltas at the current pointer position.',
    inputSchema: { type: 'object', properties: { dx: { type: 'number' }, dy: { type: 'number' } } }
  },
  {
    name: 'computer_type',
    tier: TIER.WRITE,
    description: 'Type text into the focused field as Unicode, so it works on any keyboard layout. The text is never written to the audit log in clear text.',
    inputSchema: {
      type: 'object', required: ['text'],
      properties: { text: { type: 'string' }, cps: { type: 'number', description: 'Characters per second, default 240.' } }
    }
  },
  {
    name: 'computer_key',
    tier: TIER.WRITE,
    description: 'Press a key combination, e.g. "cmd+s", "escape", "cmd+shift+4".',
    inputSchema: { type: 'object', required: ['combo'], properties: { combo: { type: 'string' } } }
  },
  {
    name: 'computer_activate',
    tier: TIER.WRITE,
    description: 'Bring an application to the front by bundle ID or name.',
    inputSchema: { type: 'object', required: ['app'], properties: { app: { type: 'string' } } }
  }
];

export const TOOL_BY_NAME = new Map(TOOLS.map(t => [t.name, t]));

/// Den saetning mennesket faar at se i dialogen. Den skal kunne laeses af én
/// der ikke kender vaerktoejet - "computer_key combo=cmd+q" siger intet,
/// "Trykker cmd+q" siger alt.
export function describe(name, args = {}) {
  switch (name) {
    case 'computer_click': return `Klikker paa skaermen i punktet ${Math.round(args.x)}, ${Math.round(args.y)}`;
    case 'computer_move': return `Flytter musen til ${Math.round(args.x)}, ${Math.round(args.y)}`;
    case 'computer_scroll': return `Ruller ${args.dy || 0} ned og ${args.dx || 0} til siden`;
    case 'computer_type': return `Skriver ${String(args.text || '').length} tegn`;
    case 'computer_key': return `Trykker ${args.combo}`;
    case 'computer_activate': return `Skifter til ${args.app}`;
    default: return name;
  }
}
