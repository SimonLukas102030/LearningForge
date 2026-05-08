#!/usr/bin/env python3
# =============================================================
#  check-distractor-bias.py
# -------------------------------------------------------------
#  B5 audit tool (Bonus, 2026-05-08, Marcus). Scans every
#  Faecher/**/questions.json and (optionally) the worker's
#  daily-challenges.js inline answer-key map, and reports
#  multiple-choice questions where the correct option is
#  significantly longer than the median distractor — the
#  pattern that lets students cheese tests with a "pick
#  longest" heuristic (~85% hit rate per Ramsey's audit).
#
#  Output:
#    - Top-20 outliers ranked by length-factor (correct.len /
#      median(distractor.len)), with file:line and an excerpt
#      of the question.
#    - Summary: total MC questions, count above 1.4x, count
#      above 2x, mean factor, file count.
#
#  IMPORTANT: this script DOES NOT MODIFY any files. Use the
#  output to manually rewrite biased questions, OR rely on
#  the runtime balancer in
#  workers/src/lib/distractor-balance.js which trims the
#  correct option at natural cut-points before serving.
#
#  Usage: py tools/check-distractor-bias.py
#  (run from repo root)
# =============================================================

import json
import os
import re
import sys
from pathlib import Path
from statistics import median

# Force UTF-8 stdout so the Windows console (cp1252 default) doesn't choke
# on superscript digits (²³⁴) or umlauts in the report output. Python 3.7+.
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

# Threshold above which a question gets flagged. Matches
# distractor-balance.js TARGET_FACTOR for consistency.
THRESHOLD = 1.4

REPO_ROOT = Path(__file__).resolve().parent.parent
FAECHER   = REPO_ROOT / 'Fächer'
WORKER_DC = REPO_ROOT / 'workers' / 'src' / 'lib' / 'daily-challenges.js'


def find_question_line(text, qid, question_text):
    """Best-effort locate the JSON-line for a given question id or text snippet."""
    if qid:
        m = re.search(r'^\s*"?id"?\s*:\s*"' + re.escape(qid) + r'"', text, re.MULTILINE)
        if m:
            return text[:m.start()].count('\n') + 1
    if question_text:
        snippet = question_text[:40]
        idx = text.find(snippet)
        if idx >= 0:
            return text[:idx].count('\n') + 1
    return None


def scan_question(q, source_text, source_path):
    if not isinstance(q, dict):
        return None
    if q.get('type') != 'multiple_choice':
        return None
    options = q.get('options')
    correct = q.get('correct')
    if not isinstance(options, list) or len(options) < 2:
        return None
    if not isinstance(correct, int) or correct < 0 or correct >= len(options):
        return None
    correct_opt = str(options[correct] or '')
    distractors = [str(o or '') for i, o in enumerate(options) if i != correct]
    if not distractors:
        return None
    med = median(len(d) for d in distractors)
    if med <= 0:
        return None
    factor = len(correct_opt) / med
    line = find_question_line(source_text, q.get('id'), q.get('question', ''))
    return {
        'file':     str(source_path.relative_to(REPO_ROOT)).replace('\\', '/'),
        'line':     line,
        'qid':      q.get('id') or '?',
        'question': (q.get('question') or '')[:90],
        'correct_len': len(correct_opt),
        'median_distractor_len': med,
        'factor':   factor
    }


def scan_questions_json():
    """Walk Fächer/**/questions.json."""
    findings = []
    if not FAECHER.exists():
        print(f'WARN: {FAECHER} not found, skipping subject scan', file=sys.stderr)
        return findings
    for qjson in FAECHER.rglob('questions.json'):
        try:
            text = qjson.read_text(encoding='utf-8')
            data = json.loads(text)
        except Exception as e:
            print(f'WARN: cannot parse {qjson}: {e}', file=sys.stderr)
            continue
        questions = data.get('questions') if isinstance(data, dict) else None
        if not isinstance(questions, list):
            continue
        for q in questions:
            r = scan_question(q, text, qjson)
            if r is not None:
                findings.append(r)
    return findings


def scan_worker_daily_challenges():
    """Extract the inline JS object literal from daily-challenges.js."""
    findings = []
    if not WORKER_DC.exists():
        print(f'WARN: {WORKER_DC} not found, skipping worker scan', file=sys.stderr)
        return findings
    text = WORKER_DC.read_text(encoding='utf-8')
    # Pull out each "'YYYY-MM-DD': [...]," array via a forgiving regex.
    # The arrays are single-line-per-question dicts so JSON-parsing each is feasible.
    for m in re.finditer(r"\{[^\n]*\"id\"[^\n]*\}", text):
        snippet = m.group(0).rstrip(',')
        try:
            q = json.loads(snippet)
        except Exception:
            continue
        r = scan_question(q, text, WORKER_DC)
        if r is not None:
            findings.append(r)
    return findings


def main():
    print(f'== distractor-bias scan (threshold = {THRESHOLD:.1f}x) ==\n')

    fa = scan_questions_json()
    wo = scan_worker_daily_challenges()
    all_findings = fa + wo

    if not all_findings:
        print('No MC questions found.')
        return 0

    flagged = [f for f in all_findings if f['factor'] > THRESHOLD]
    over_2x = [f for f in all_findings if f['factor'] > 2.0]

    avg_factor = sum(f['factor'] for f in all_findings) / len(all_findings)
    files = {f['file'] for f in all_findings}

    print(f'Files scanned    : {len(files)}')
    print(f'MC questions     : {len(all_findings)}')
    print(f'Flagged (>{THRESHOLD:.1f}x): {len(flagged)} ({100*len(flagged)/len(all_findings):.0f}%)')
    print(f'Severe (>2.0x)   : {len(over_2x)} ({100*len(over_2x)/len(all_findings):.0f}%)')
    print(f'Mean factor      : {avg_factor:.2f}x\n')

    flagged.sort(key=lambda f: -f['factor'])
    print(f'== Top-{min(20, len(flagged))} outliers ==\n')
    for i, f in enumerate(flagged[:20], 1):
        loc = f"{f['file']}:{f['line']}" if f['line'] else f['file']
        print(f"  {i:2d}. {f['factor']:.2f}x  [{f['qid']}]  {loc}")
        print(f"      {f['question']}")
        print(f"      correct={f['correct_len']} chars, median-distractor={f['median_distractor_len']:.0f} chars\n")

    return 0 if len(flagged) == 0 else 1  # non-zero exit if any flagged (CI-friendly)


if __name__ == '__main__':
    sys.exit(main())
