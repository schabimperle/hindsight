"""Verify synthetic fixtures and expected results against the oracle; --write regenerates them."""
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WRITE = "--write" in sys.argv[1:]


def same(a, b):
    """Equal up to float noise: libm results differ in the last bits between CPUs (FMA or not)."""
    if isinstance(a, float) or isinstance(b, float):
        return isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a == b


CASES = [("main", ""), ("edge", "-edge"), ("window", "-window"), ("short", "-short"), ("mix", "-mix")]
for case, suffix in CASES:
    fixture = ROOT / f"test/fixtures/synthetic{suffix}.json"
    expected = fixture.with_suffix(".expected.json")
    generated = subprocess.check_output(
        [sys.executable, "-I", str(ROOT / "reference/make_fixture.py"), case], cwd=ROOT
    )
    if WRITE:
        fixture.write_bytes(generated)
    actual = subprocess.check_output(
        [sys.executable, "-I", str(ROOT / "reference/oracle.py"), str(fixture)], cwd=ROOT
    )
    if WRITE:
        expected.write_bytes(actual)
        continue
    if not same(json.loads(generated), json.loads(fixture.read_text())):
        sys.exit(f"Synthetic fixture drift: {fixture.name}")
    if not same(json.loads(actual), json.loads(expected.read_text())):
        sys.exit(f"Oracle drift: {expected.name}")
print(f"Wrote {len(CASES)} fixtures and expectations." if WRITE else f"All {len(CASES)} synthetic fixtures and oracle expectations match.")
