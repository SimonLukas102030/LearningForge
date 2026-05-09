"""
Merge subtopic-question-parts into a single questions.json per topic.

Usage from Storage\AI\LearningForge:
  py Fächer\Biologie\Klasse-9\merge_questions.py

For each topic folder containing _parts\s1-questions.json...s4-questions.json,
writes a combined questions.json next to _parts\.
Idempotent — overwrite OK.
"""
import json
import os
from pathlib import Path

BASE = Path(__file__).parent  # Fächer/Biologie/Klasse-9


def merge_topic(topic_dir: Path) -> None:
    parts_dir = topic_dir / "_parts"
    if not parts_dir.is_dir():
        print(f"  skip — no _parts: {topic_dir.name}")
        return

    all_questions = []
    for i in range(1, 5):
        part_file = parts_dir / f"s{i}-questions.json"
        if not part_file.is_file():
            print(f"  WARN — missing {part_file.name}")
            continue
        data = json.loads(part_file.read_text(encoding="utf-8"))
        qs = data.get("questions", [])
        all_questions.extend(qs)
        print(f"  + s{i}: {len(qs)} questions")

    out = topic_dir / "questions.json"
    out.write_text(
        json.dumps({"questions": all_questions}, ensure_ascii=False, indent=None, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"  -> {out.name}: {len(all_questions)} total\n")


def main() -> None:
    for entry in sorted(BASE.iterdir()):
        if entry.is_dir() and (entry / "_parts").is_dir():
            print(f"Topic: {entry.name}")
            merge_topic(entry)


if __name__ == "__main__":
    main()
