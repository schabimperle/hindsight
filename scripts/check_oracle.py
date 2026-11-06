"""Verify synthetic fixtures and expected results against the independent oracle."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CASES = [("main", ""), ("edge", "-edge"), ("window", "-window"), ("short", "-short"), ("mix", "-mix")]
for case, suffix in CASES:
    fixture = ROOT / f"test/fixtures/synthetic{suffix}.json"
    expected = fixture.with_suffix(".expected.json")
    generated = subprocess.check_output(
        [sys.executable, "-I", str(ROOT / "reference/make_fixture.py"), case], cwd=ROOT
    )
    actual = subprocess.check_output(
        [sys.executable, "-I", str(ROOT / "reference/oracle.py"), str(fixture)], cwd=ROOT
    )
    if json.loads(generated) != json.loads(fixture.read_text()):
        sys.exit(f"Synthetic fixture drift: {fixture.name}")
    if json.loads(actual) != json.loads(expected.read_text()):
        sys.exit(f"Oracle drift: {expected.name}")
print(f"All {len(CASES)} synthetic fixtures and oracle expectations match.")
