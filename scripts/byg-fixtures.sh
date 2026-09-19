#!/bin/bash
# Bygger proevernes attrapper. Koeres af run-all.sh hvis de mangler.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for f in "$ROOT"/test/fixtures/*.swift; do
  ud="${f%.swift}"
  if [ ! -x "$ud" ] || [ "$f" -nt "$ud" ]; then
    echo "bygger attrap: $(basename "$ud")"
    swiftc -O "$f" -o "$ud"
  fi
done
