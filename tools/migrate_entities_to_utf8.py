#!/usr/bin/env python3
"""
migrate_entities_to_utf8.py
---------------------------
One-shot migration: rewrite all Fächer/**/*.json + changelog.json from
HTML-entity-encoded special chars to raw UTF-8.

Default = dry-run (prints what *would* change).  Pass --apply to write.

Why: mixed-encoding (some files raw, some entities) was causing render
bugs where a textContent path showed `&uuml;` literally.  JSON+UTF-8 is
natively supported, no escaping needed.

Usage:
    py tools/migrate_entities_to_utf8.py            # dry-run
    py tools/migrate_entities_to_utf8.py --apply    # actually rewrite
    py tools/migrate_entities_to_utf8.py --apply --verbose
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
from collections import Counter
from typing import Dict, List, Tuple

# Force UTF-8 stdout (Windows cp1252 default crashes on non-ASCII prints)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", line_buffering=True)

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))

# ---------------------------------------------------------------------------
# Substitution map
# ---------------------------------------------------------------------------
# IMPORTANT: &amp; is processed LAST so we don't double-decode anything.
NAMED_ENTITIES: Dict[str, str] = {
    # German umlauts
    "auml": "ä", "ouml": "ö", "uuml": "ü",
    "Auml": "Ä", "Ouml": "Ö", "Uuml": "Ü",
    "szlig": "ß",
    # Quotes / dashes
    "bdquo": "„", "ldquo": "“", "lsquo": "‘", "rsquo": "’",
    "ndash": "–", "mdash": "—",
    "laquo": "«", "raquo": "»",
    "prime": "′", "Prime": "″",
    "hellip": "…",
    # Math / operators
    "times": "×", "middot": "·", "minus": "−", "plusmn": "±", "Plusmn": "±",
    "divide": "÷", "asymp": "≈", "ne": "≠", "ge": "≥", "le": "≤",
    "radic": "√", "prop": "∝", "infin": "∞",
    "sup1": "¹", "sup2": "²", "sup3": "³",
    "sub1": "₁", "sub2": "₂", "sub3": "₃",
    "frac12": "½", "frac14": "¼", "frac34": "¾",
    # Symbols
    "deg": "°", "micro": "µ",
    "copy": "©", "reg": "®", "trade": "™",
    "euro": "€", "pound": "£", "cent": "¢", "yen": "¥",
    "sect": "§", "para": "¶", "bull": "•",
    "shy": "­",  # soft hyphen
    "nbsp": " ",
    # Arrows
    "rarr": "→", "larr": "←", "uarr": "↑", "darr": "↓", "harr": "↔",
    # Greek
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε",
    "zeta": "ζ", "eta": "η", "theta": "θ", "iota": "ι", "kappa": "κ",
    "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "omicron": "ο",
    "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ", "upsilon": "υ",
    "phi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
    "Alpha": "Α", "Beta": "Β", "Gamma": "Γ", "Delta": "Δ", "Epsilon": "Ε",
    "Theta": "Θ", "Lambda": "Λ", "Sigma": "Σ", "Phi": "Φ", "Omega": "Ω",
    # Misc Latin (used in Latein content)
    "eacute": "é", "egrave": "è", "ecirc": "ê", "euml": "ë",
    "aacute": "á", "agrave": "à", "acirc": "â",
    "iacute": "í", "icirc": "î",
    "oacute": "ó", "ograve": "ò", "ocirc": "ô", "oslash": "ø",
    "uacute": "ú", "ugrave": "ù", "ucirc": "û",
    "ccedil": "ç", "ntilde": "ñ",
    # XML/HTML special — we INTENTIONALLY do NOT migrate these:
    #   &lt; &gt; &amp; &quot; &apos;
    # Reason: they are also valid inside HTML embedded in JSON content.
    # Decoding them here could break embedded markup like
    #   "<em>x &lt; y</em>".  We leave them as-is.
}

# Set of names we *recognise* but explicitly skip (safer to keep encoded).
KEEP_AS_ENTITY = {"lt", "gt", "amp", "quot", "apos"}


def build_named_pattern() -> re.Pattern:
    # Match any &word; — we'll replace per-name in the callback.
    return re.compile(r"&([a-zA-Z][a-zA-Z0-9]{1,15});")


NAMED_RE = build_named_pattern()
NUMERIC_DEC_RE = re.compile(r"&#([0-9]{1,7});")
NUMERIC_HEX_RE = re.compile(r"&#x([0-9a-fA-F]{1,6});")


# ---------------------------------------------------------------------------
# Substitution engine
# ---------------------------------------------------------------------------
def substitute(text: str, stats: Counter, unknown: Counter) -> str:
    def named_repl(m: re.Match) -> str:
        name = m.group(1)
        if name in KEEP_AS_ENTITY:
            return m.group(0)  # keep as-is
        if name in NAMED_ENTITIES:
            stats[name] += 1
            return NAMED_ENTITIES[name]
        unknown[name] += 1
        return m.group(0)  # leave untouched, will be reported

    def numeric_dec_repl(m: re.Match) -> str:
        cp = int(m.group(1))
        if 0 < cp <= 0x10FFFF:
            stats[f"#{cp}"] += 1
            return chr(cp)
        return m.group(0)

    def numeric_hex_repl(m: re.Match) -> str:
        cp = int(m.group(1), 16)
        if 0 < cp <= 0x10FFFF:
            stats[f"#x{m.group(1)}"] += 1
            return chr(cp)
        return m.group(0)

    text = NAMED_RE.sub(named_repl, text)
    text = NUMERIC_DEC_RE.sub(numeric_dec_repl, text)
    text = NUMERIC_HEX_RE.sub(numeric_hex_repl, text)
    return text


# ---------------------------------------------------------------------------
# File walker
# ---------------------------------------------------------------------------
def collect_targets() -> List[str]:
    targets: List[str] = []
    faecher = os.path.join(REPO_ROOT, "Fächer")
    for dp, _, fns in os.walk(faecher):
        for fn in fns:
            if not fn.endswith(".json"):
                continue
            # Skip the english-keyed config file
            if fn == "subjects-config.json":
                continue
            targets.append(os.path.join(dp, fn))
    changelog = os.path.join(REPO_ROOT, "changelog.json")
    if os.path.isfile(changelog):
        targets.append(changelog)
    return targets


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--apply", action="store_true", help="actually rewrite files (default = dry-run)")
    g.add_argument("--dry-run", action="store_true", help="explicit dry-run (default)")
    ap.add_argument("-v", "--verbose", action="store_true", help="list every changed file")
    args = ap.parse_args()
    apply_changes = bool(args.apply)

    targets = collect_targets()
    print(f"Scanning {len(targets)} JSON file(s) under repo root: {REPO_ROOT}")
    print(f"Mode: {'APPLY (will write)' if apply_changes else 'DRY-RUN (no writes)'}")
    print("-" * 70)

    total_files_changed = 0
    total_subs = Counter()
    unknown_global = Counter()
    json_failures: List[Tuple[str, str]] = []
    read_failures: List[Tuple[str, str]] = []
    write_failures: List[Tuple[str, str]] = []
    per_file_changes: List[Tuple[str, int]] = []

    for path in targets:
        try:
            with open(path, "r", encoding="utf-8") as f:
                original = f.read()
        except Exception as e:
            read_failures.append((path, str(e)))
            continue

        local_stats = Counter()
        local_unknown = Counter()
        new_text = substitute(original, local_stats, local_unknown)

        if new_text == original:
            continue  # nothing to do

        # Validate the result is still parseable JSON
        try:
            json.loads(new_text)
        except json.JSONDecodeError as e:
            json_failures.append((path, f"{e.msg} at line {e.lineno} col {e.colno}"))
            continue

        rel = os.path.relpath(path, REPO_ROOT)
        sub_count = sum(local_stats.values())
        per_file_changes.append((rel, sub_count))
        total_files_changed += 1
        total_subs.update(local_stats)
        unknown_global.update(local_unknown)

        if args.verbose:
            top = ", ".join(f"{k}×{v}" for k, v in local_stats.most_common(5))
            print(f"  {rel}  ({sub_count} subs: {top})")

        if apply_changes:
            try:
                # UTF-8 WITHOUT BOM, LF preserved as-is from input.
                with open(path, "w", encoding="utf-8", newline="") as f:
                    f.write(new_text)
            except Exception as e:
                write_failures.append((path, str(e)))
                continue

    # ------------------------------------------------------------------ summary
    print("-" * 70)
    print(f"Files that {'were' if apply_changes else 'would be'} changed: {total_files_changed}")
    print(f"Total substitutions: {sum(total_subs.values())}")
    if total_subs:
        print("Top substitutions:")
        for k, v in total_subs.most_common(20):
            print(f"  {k:12s} {v}")
    if unknown_global:
        print()
        print("WARNING — unknown entities encountered (left as-is):")
        for k, v in unknown_global.most_common():
            print(f"  &{k};  ×{v}")
    if json_failures:
        print()
        print("ERROR — files where substitution would break JSON validity (skipped):")
        for p, msg in json_failures:
            print(f"  {p}: {msg}")
    if read_failures:
        print()
        print("ERROR — read failures:")
        for p, msg in read_failures:
            print(f"  {p}: {msg}")
    if write_failures:
        print()
        print("ERROR — write failures:")
        for p, msg in write_failures:
            print(f"  {p}: {msg}")

    if not apply_changes:
        print()
        print("Dry-run complete. Re-run with --apply to actually write.")

    # Exit non-zero if there were any failures
    return 1 if (json_failures or read_failures or write_failures) else 0


if __name__ == "__main__":
    sys.exit(main())
