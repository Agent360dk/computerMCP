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
    name: 'computer_displays',
    tier: TIER.READ,
    description: 'List the displays: their stable id, position on the desktop, and size. Call this when a window is not where you expect - on a machine with several screens it is usually on another one. Use the id with computer_screenshot, never the index: the order is not stable between calls.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'computer_launch',
    tier: TIER.WRITE,
    description: 'Open an application, by bundle ID or by its plain name ("Notes"). computer_activate can only bring forward something already running; this starts what is closed. If it is already running it just comes forward, and the answer says so. Launching cannot lose anything, so it does not ask for consent - quitting is a different tool for exactly that reason.',
    inputSchema: {
      type: 'object',
      properties: { app: { type: 'string', description: 'Bundle ID, or the app name as it appears in Applications.' } },
      required: ['app']
    }
  },
  {
    name: 'computer_quit',
    tier: TIER.WRITE,
    description: 'Ask an application to quit, the same way Cmd+Q does - so it still gets to ask you about unsaved work. It never kills a process. Quitting can lose work, so it asks for consent every time, in every mode.',
    inputSchema: {
      type: 'object',
      properties: { app: { type: 'string', description: 'Bundle ID or app name. It must be running.' } },
      required: ['app']
    }
  },
  {
    name: 'computer_drag',
    tier: TIER.WRITE,
    description: 'Drag from one point to another: a file into a folder, a row into a new position in a list, a slider to a value. Coordinates are in POINTS, the same as computer_click - take them from computer_find, which gives you a center for every element it returns. Like clicking, this moves the real cursor, so it is not the quiet route; where an app publishes an accessibility tree, computer_press and computer_set_value do more without touching the pointer. It reports that the drag was sent, never that it was accepted - only a screenshot or a fresh look at the tree can tell you that.',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number', description: 'Where the drag starts, in points.' },
        fromY: { type: 'number' },
        toX: { type: 'number', description: 'Where it ends, in points.' },
        toY: { type: 'number' },
        steps: { type: 'number', description: 'How many intermediate moves. Default 24. A drag sent in one jump is ignored by most lists.' },
        holdMs: { type: 'number', description: 'How long to hold the button down before moving, in milliseconds. Default 120. Finder and most lists need a moment before they accept that a drag has begun.' }
      },
      required: ['fromX', 'fromY', 'toX', 'toY']
    }
  },
  {
    name: 'computer_space',
    tier: TIER.WRITE,
    description: 'Switch to the desktop (Space) to the left or right, the way Control+Arrow does. This is how you reach a full-screen app: macOS gives every full-screen window its own Space, so a window you cannot find is often simply on another one. It moves what the person is looking at, so it asks for consent every time, in every mode - the same rule as quitting an app. If the system shortcut for switching Spaces is turned off on this machine it says so and sends nothing, rather than pressing a key that does nothing. And it tells you whether the desktop actually changed, measured by which windows are on screen before and after - it will not claim a switch it cannot prove.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['left', 'right'], description: 'Which way to go.' }
      },
      required: ['direction']
    }
  },
  {
    name: 'computer_paste',
    tier: TIER.WRITE,
    description: 'Put text on the clipboard, press Cmd+V, then put your own clipboard back. Use it instead of computer_type for anything long or awkward - a paragraph, a URL, an emoji, text in a script the keyboard layout cannot produce - because it lands in one step rather than character by character. There is deliberately NO tool that READS the clipboard: a person copies a password out of their password manager, and one read would hand it to the model past every other guard. To put your previous clipboard back this does read it, in memory only, for the few milliseconds the paste takes; that value is never returned and never logged. Pass restore=false to skip that read entirely, at the cost of leaving this text on your clipboard.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to paste. Never written to the audit log in clear - it is stored as a length and a salted hash, like typed text.' },
        restore: { type: 'boolean', description: 'Default true: put your own clipboard back afterwards. false skips reading it at all.' }
      },
      required: ['text']
    }
  },
  {
    name: 'computer_window',
    tier: TIER.WRITE,
    description: 'Move, resize, close or minimise a window. Coordinates are global points, the same space computer_click uses, so a negative x is a screen to the left - this is how you put a window on another display. Closing a window can lose unsaved work, so close asks for consent every time, in every mode.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Bundle ID or app name.' },
        title: { type: 'string', description: 'Match the window by a substring of its title. Omit to use index.' },
        index: { type: 'number', description: 'Which window, 0-based, when no title is given. Default 0.' },
        x: { type: 'number', description: 'New left edge, in global points. Negative means a display to the left - see computer_displays.' },
        y: { type: 'number', description: 'New top edge, in global points.' },
        width: { type: 'number' },
        height: { type: 'number' },
        button: { type: 'string', enum: ['close', 'minimize'], description: 'Press the window\'s own close or minimise button instead of moving it.' }
      },
      required: ['app']
    }
  },
  {
    name: 'computer_menus',
    tier: TIER.READ,
    description: 'Read an app\'s menu bar: every item as a full path like "File > Export as…", whether it is enabled right now, and its keyboard shortcut. A large part of macOS has no button on screen at all - it lives in a menu - so this is often the only way to reach an action. Reading is free; use it before computer_menu so you click a path that exists.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Bundle ID or app name. The app must be running.' },
        depth: { type: 'number', description: 'How deep into submenus to go. Default 5.' }
      },
      required: ['app']
    }
  },
  {
    name: 'computer_menu',
    tier: TIER.WRITE,
    description: 'Choose a menu item by its full path, e.g. "File > Export as…". Works through the accessibility API, so it reaches a window that is BEHIND another one and never moves your pointer - the same way computer_press does. Always give the whole path: "Delete" exists in several menus and hitting the wrong one is not a detail. Items whose name suggests deleting, clearing or quitting ask for consent every time, in every mode.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Bundle ID or app name.' },
        path: { type: 'string', description: 'Full menu path, separated by >. Take it from computer_menus rather than guessing - the titles are in the system language.' }
      },
      required: ['app', 'path']
    }
  },
  {
    name: 'computer_screenshot',
    tier: TIER.READ,
    description: 'Screenshot ONE display, or one app. Password fields and password-manager windows are blacked out BEFORE the image is written, so they never reach the model. On a machine with several displays this captures one of them; the answer says which, how many there are, and where that screen sits on the desktop. A window you cannot find is usually on another display - call computer_displays and pass displayId. Set redact=false only if you know the screen holds no secrets.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Bundle ID or app name. Omit for the whole screen.' },
        redact: { type: 'boolean', description: 'Default true. Blacks out secure fields.' },
        maxWidth: { type: 'number', description: 'Scale down to this width in pixels. Default 1400.' },
        displayId: { type: 'number', description: 'Which display, by the stable id from computer_displays. Prefer this over display.' },
        display: { type: 'number', description: 'Which display by position in the list, 0-based. ⛔ The order is NOT stable between calls - measured changing within a single run. Use displayId instead unless you have just listed them.' }
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
    name: 'computer_pending',
    tier: TIER.READ,
    description: 'List the actions that were refused because they needed a human and there was no way to ask without taking over the screen. In background mode a dialog is itself an interruption, so a write that would need one is refused rather than raised - and the refusal only reaches the person if they happen to read the right conversation. This is where it becomes visible: what was asked for, when, and why it stopped. It is a list, not a button. Nothing here can be approved from here - a consent granted without a human is exactly what the gate exists to prevent. To allow the work, the person changes mode; this only says what is waiting.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many of the most recent to return. Default 20.' } }
    }
  },
  {
    name: 'computer_audit',
    tier: TIER.READ,
    description: 'Show what this server has done: the last N entries of the append-only audit log.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Default 40.' } } }
  },
  {
    name: 'computer_find',
    tier: TIER.READ,
    description: 'Find elements by role, title or substring and get their frame, centre and whether they can be pressed. Coordinates come back in POINTS, which is what computer_click takes - so this is the way to act on "the Log in button" instead of on a pixel that stops being true the moment a window moves.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Bundle ID or app name. Omit to search every app on screen.' },
        role: { type: 'string', description: 'Accessibility role, e.g. AXButton, AXTextField.' },
        title: { type: 'string', description: 'Exact title, label or value.' },
        contains: { type: 'string', description: 'Substring of the title, label or value.' },
        depth: { type: 'number', description: 'Default 24.' },
        limit: { type: 'number', description: 'Max matches, default 25.' }
      }
    }
  },
  {
    name: 'computer_wait_for',
    tier: TIER.READ,
    description: 'Wait until an element appears, instead of taking screenshots in a loop. Give it the same search as computer_find plus a timeout in seconds; it returns as soon as something matches, or says plainly that nothing appeared. Twenty polls cost one call here and twenty images the other way - and an image is the most expensive thing you can put in a context window.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Bundle ID or app name. Strongly recommended - without it every app on screen is walked on every poll.' },
        role: { type: 'string', description: 'Accessibility role, e.g. AXButton.' },
        title: { type: 'string', description: 'Exact title, label or value.' },
        contains: { type: 'string', description: 'Substring of the title, label or value.' },
        timeout: { type: 'number', description: 'Seconds to keep looking. Default 15.' },
        poll: { type: 'number', description: 'Milliseconds between looks. Default 400, minimum 100.' }
      }
    }
  },
  {
    name: 'computer_focused',
    tier: TIER.READ,
    description: 'What has keyboard focus right now, and is it a secure field? Returns the role, subrole, title and a "secure" flag. Call it before typing or setting a value when you are not certain where the cursor is - "I think it is in the search box" is not knowing.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'computer_set_value',
    tier: TIER.WRITE,
    description: 'Write text straight into a text field, without focusing it and without moving the pointer. Works on a window sitting behind another one. Give it the same search as computer_find, or omit the search to write into whatever has focus. REFUSES on a secure field, every time - for a password, use computer_ask_user and let the human type it. The text is sent on stdin, never as a command-line argument.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'What to put in the field. Replaces what is there.' },
        app: { type: 'string', description: 'Bundle ID or app name.' },
        role: { type: 'string' },
        title: { type: 'string' },
        contains: { type: 'string' },
        first: { type: 'boolean', description: 'Accept the first match when several fit. Default false, which refuses.' }
      }
    }
  },
  {
    name: 'computer_press',
    tier: TIER.WRITE,
    description: 'Press an element through its own accessibility action instead of simulating a click on a coordinate. Works while the window is BEHIND another one and never moves the human\'s mouse pointer - so it is the tool to reach for when the agent should not take over the screen. Two or more matches is a refusal, not a guess: narrow the search, or pass first=true if you mean the first one.',
    inputSchema: {
      type: 'object',
      required: ['app'],
      properties: {
        app: { type: 'string', description: 'Bundle ID or app name. Required, because this is also what decides whether the app is one that always asks.' },
        role: { type: 'string' },
        title: { type: 'string' },
        contains: { type: 'string' },
        first: { type: 'boolean', description: 'Accept the first match when several fit. Default false, which refuses instead.' }
      }
    }
  },
  {
    name: 'computer_ask_user',
    tier: TIER.WRITE,
    description: 'Ask the human to do something themselves, and wait. Use it for anything you must NOT see: a password, a 2FA code, a CAPTCHA, an OAuth consent. Put the cursor in the right field first (computer_find, then computer_press), then call this - the human types on their own keyboard and presses Done. You get back true or false, never the text. There is deliberately no way to receive a secret through this server; if you need one typed, this is the only route.',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string', description: 'What the human should do, in one sentence. Say why, so they can judge whether to refuse.' }
      }
    }
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
  // ⛔ DENNE TEKST STAAR I SAMTYKKE-DIALOGEN. Det er den saetning mennesket
  //    laeser lige foer det siger ja eller nej - og den var paa dansk paa et
  //    produkt hvis site er engelsk. Et samtykke man ikke kan laese, er ikke
  //    et samtykke.
  const maal = [args.title, args.contains, args.role].filter(Boolean)[0];
  switch (name) {
    case 'computer_click': return `Click on screen at ${Math.round(args.x)}, ${Math.round(args.y)}`;
    case 'computer_move': return `Move the pointer to ${Math.round(args.x)}, ${Math.round(args.y)}`;
    case 'computer_scroll': return `Scroll ${args.dy || 0} down and ${args.dx || 0} across`;
    case 'computer_drag': return `Drag from ${Math.round(args.fromX)}, ${Math.round(args.fromY)} to ${Math.round(args.toX)}, ${Math.round(args.toY)}`;
    case 'computer_type': return `Type ${String(args.text || '').length} characters`;
    case 'computer_key': return `Press ${args.combo}`;
    case 'computer_press': return `Press ${maal ? `"${maal}"` : 'an element'} in ${args.app}`;
    case 'computer_set_value': return `Write ${String(args.text || '').length} characters into a field${args.app ? ' in ' + args.app : ''}`;
    case 'computer_ask_user': return `Ask you to do something yourself`;
    case 'computer_activate': return `Switch to ${args.app}`;
    case 'computer_launch': return `Open ${args.app}`;
    case 'computer_quit': return `Quit ${args.app}`;
    case 'computer_menu': return `Choose the menu item "${args.path}"${args.app ? ' in ' + args.app : ''}`;
    case 'computer_window': return `${args.button ? args.button[0].toUpperCase() + args.button.slice(1) : 'Change'} a window${args.app ? ' in ' + args.app : ''}`;
    case 'computer_paste': return `Paste ${String(args.text || '').length} characters`;
    case 'computer_space': return `Switch to the desktop on the ${args.direction}`;
    default: return name;
  }
}
