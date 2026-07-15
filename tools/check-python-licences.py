"""Fails when a package in the Docling worker has a licence we cannot ship, or is one we never use.

Run with the worker's own Python, after `uv sync --frozen`:
    packages/node/python/.venv/bin/python tools/check-python-licences.py

Uses the same policy as the npm check (tools/licence-policy.json). A package's licence is read
from its installed metadata: the SPDX License-Expression when it has one, else a short License
field, else its trove classifiers.
"""

from __future__ import annotations

import json
import re
import sys
import tomllib
from importlib.metadata import PackageNotFoundError, distribution
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / "packages" / "node" / "python" / "uv.lock"
POLICY = json.loads((ROOT / "tools" / "licence-policy.json").read_text())

# Trove classifiers and free-text licence names, as SPDX identifiers.
NAMES = {
    "mit": "MIT",
    "mit license": "MIT",
    "the mit license": "MIT",
    "mit-0": "MIT-0",
    "apache 2.0": "Apache-2.0",
    "apache-2.0": "Apache-2.0",
    "apache license 2.0": "Apache-2.0",
    "apache license, version 2.0": "Apache-2.0",
    "apache software license": "Apache-2.0",
    "apache 2": "Apache-2.0",
    "apache 2.0 license": "Apache-2.0",
    "apache": "Apache-2.0",
    "psfl": "Python-2.0",
    "bsd": "BSD-3-Clause",
    "bsd license": "BSD-3-Clause",
    "bsd-2-clause": "BSD-2-Clause",
    "bsd-3-clause": "BSD-3-Clause",
    "new bsd license": "BSD-3-Clause",
    "3-clause bsd license": "BSD-3-Clause",
    "isc": "ISC",
    "isc license (iscl)": "ISC",
    "python software foundation license": "Python-2.0",
    "psf": "Python-2.0",
    "psf-2.0": "Python-2.0",
    "the unlicense (unlicense)": "Unlicense",
    "zlib/libpng license": "Zlib",
    "mozilla public license 2.0 (mpl 2.0)": "MPL-2.0",
    "mpl-2.0": "MPL-2.0",
}


# a License field that is already an SPDX expression, such as "MPL-2.0 AND MIT"
SPDX = re.compile(r"^[A-Za-z0-9.+-]+( (AND|OR) [A-Za-z0-9.+-]+)*$")


def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def licence_of(name: str) -> str | None:
    meta = distribution(name).metadata
    expression = meta.get("License-Expression")
    if expression:
        return expression.strip()
    text = (meta.get("License") or "").strip()
    if text and len(text) < 80 and "\n" not in text:
        known = NAMES.get(text.lower())
        if known:
            return known
        if SPDX.match(text):
            return text
    found = [NAMES.get(c.split("::")[-1].strip().lower()) for c in meta.get_all("Classifier") or [] if c.startswith("License ::")]
    found = [f for f in found if f]
    if found:
        return " OR ".join(sorted(set(found)))
    return None


def allowed(expression: str, allow: set[str]) -> bool:
    """OR needs one side allowed, AND needs both; WITH exceptions only widen a licence."""
    tokens = re.sub(r"([()])", r" \1 ", expression).split()
    position = 0

    def either() -> bool:
        nonlocal position
        ok = both()
        while position < len(tokens) and tokens[position] == "OR":
            position += 1
            ok = both() or ok
        return ok

    def both() -> bool:
        nonlocal position
        ok = atom()
        while position < len(tokens) and tokens[position] == "AND":
            position += 1
            ok = atom() and ok
        return ok

    def atom() -> bool:
        nonlocal position
        token = tokens[position]
        position += 1
        if token == "(":
            ok = either()
            position += 1
            result = ok
        else:
            result = token in allow
        if position < len(tokens) and tokens[position] == "WITH":
            position += 2
        return result

    return either()


def main() -> int:
    allow = set(POLICY["allow"])
    deny = {norm(k): v for k, v in POLICY["deny"].items()}
    exceptions = POLICY.get("exceptions", {})
    lock = tomllib.loads(LOCK.read_text())
    problems = []
    checked = 0
    for package in lock["package"]:
        name, version = package["name"], package["version"]
        if package.get("source", {}).get("editable") or package.get("source", {}).get("virtual"):
            continue  # the worker itself
        if norm(name) in deny:
            problems.append(f"{name} {version}: never used here ({deny[norm(name)]})")
            continue
        if f"{name}@{version}" in exceptions:
            checked += 1
            continue
        try:
            expression = licence_of(name)
        except PackageNotFoundError:
            continue  # only installed on other systems (another OS or Python); checked there
        checked += 1
        if expression is None:
            problems.append(f"{name} {version}: no licence found; check it by hand and add an exception")
        elif not allowed(expression, allow):
            problems.append(f"{name} {version}: {expression}")
    if problems:
        print("Python licence problems:\n  " + "\n  ".join(problems))
        return 1
    print(f"Python licences ok: {checked} packages.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
