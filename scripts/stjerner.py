#!/usr/bin/env python3
"""Sætter GitHub-stjernerne ind i forsidens stjerneknap, når siden bygges (.github/workflows/side.yml).
Siden lover ingen scripts og ingen tredjepartskald i browseren, så tallet kan ikke hentes live dér.
Tallet vises fra 1 (Gustav 2/10: «Dertil kan jeg bedre lide når den viser stjernerne live», sagt to gange).
Ved 0 står knappen uden tal.
Kan køres igen og igen: indholdet mellem markørerne erstattes hver gang.

Kør: python3 scripts/stjerner.py docs/index.html 42"""
import re
import sys

GRAENSE = 1
A, B = '<!-- STJERNER -->', '<!-- /STJERNER -->'


def kort(n):
    if n < 1000:
        return str(n)
    return f'{n / 1000:.1f}'.rstrip('0').rstrip('.') + 'k'


def saet_ind(t, n):
    assert t.count(A) == 1 and t.count(B) == 1, 'markørerne STJERNER mangler i siden'
    vis = n >= GRAENSE
    i = t.index(A) + len(A)
    j = t.index(B)
    t = t[:i] + (f'<b>{kort(n)}</b>' if vis else '') + t[j:]
    navn = f'Star Computer MCP on GitHub, {n} star' + ('' if n == 1 else 's') if vis else 'Star Computer MCP on GitHub'
    t, antal = re.subn(r'(<a class="star"[^>]*aria-label=")[^"]*(")', lambda m: m.group(1) + navn + m.group(2), t)
    assert antal == 1, 'stjerneknappen blev ikke fundet'
    return t


if __name__ == '__main__':
    sti, n = sys.argv[1], int(sys.argv[2])
    t = open(sti, encoding='utf-8').read()
    open(sti, 'w', encoding='utf-8').write(saet_ind(t, n))
    print(f'{n} stjerner:', 'vist' if n >= GRAENSE else f'ikke vist (under {GRAENSE})')
