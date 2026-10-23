# python -I arrdiff.py <fileA> <fileB> <needle>: the whole array literal starting at needle in each file
# (bracket-matched), split into {...} entries; prints entries only on one side (minified identifiers in
# when/gate values masked).
import re, sys

def array(path, needle):
    s = open(path, encoding="utf-8").read()
    i = s.index(needle)
    depth = 0
    for j in range(i, len(s)):
        c = s[j]
        if c in "[{(":
            depth += 1
        elif c in "]})":
            depth -= 1
            if depth == 0:
                return s[i:j + 1]
    raise SystemExit("unbalanced")

def entries(text):
    out, depth, start = [], 0, None
    for j, c in enumerate(text):
        if c == "{":
            if depth == 0:
                start = j
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                out.append(text[start:j + 1])
    return out

a, b, needle = sys.argv[1:4]
ea, eb = entries(array(a, needle)), entries(array(b, needle))
norm = lambda e: re.sub(r"\b(when|gate):([A-Za-z$_]{1,3})\b", r"\1:X", e)
na, nb = set(map(norm, ea)), set(map(norm, eb))
for e in ea:
    if norm(e) not in nb:
        print("-", e)
for e in eb:
    if norm(e) not in na:
        print("+", e)
print(len(ea), "->", len(eb))
