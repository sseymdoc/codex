#!/usr/bin/env bash
# sweep.sh <cites-file>: for each chunk in the cites file (lines "chunk name"), match its names
# across versions and print only the functions whose tokens changed (or that did not match).
here="$(dirname "$0")"
for chunk in $(awk '{print $1}' "$1" | tr -d '\r' | sort -u); do
  names=$(awk -v c="$chunk" '$1==c {print $2}' "$1" | tr -d '\r' | tr '\n' ' ')
  match=$(node "$here/fnmatch.mjs" "$chunk" $names 2>&1 | grep -E "^[A-Za-z0-9_\$]+ (->|:)|^Error:")
  diff=$(node "$here/tokdiff.mjs" "$chunk" $names 2>&1 | grep -v "same tokens")
  echo "## $chunk"
  echo "$match" | grep -E "not in|no match|^Error:" | sed 's/^/   ?? /'
  echo "$match" | grep -- "->" | awk '{print "   "$1" -> "$3" ("$5")"}' | tr '\n' ' '; echo
  echo "$diff" | grep -v -e "no files" -e '^$' | cut -c1-600 | sed 's/^/   Δ /'
done
