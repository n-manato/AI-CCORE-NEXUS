#!/usr/bin/env python3
"""Relocate a Python venv in place: fix pyvenv.cfg, activate scripts and bin/ shebangs.

Usage: repair_venv.py <venv_dir> <old_abs_path> <new_abs_path>

A venv resolves sys.prefix from the location of bin/python (plus the adjacent
pyvenv.cfg), so a moved venv already works when invoked as <venv>/bin/python.
What actually breaks is every console script in bin/, whose shebang hardcodes
the old interpreter path.

The destination here contains a space ("AICCORE Nexus"), and the kernel splits a
shebang on the first space -- a plain `#!/path/with space/python` can never
work. CPython's own venv module handles this by emitting a /bin/sh polyglot
wrapper instead, so we emit exactly that form.
"""
import pathlib
import sys


def polyglot(python: str) -> str:
    return "#!/bin/sh\n'''exec' \"%s\" \"$0\" \"$@\"\n' '''\n" % python


def main() -> int:
    venv, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
    root = pathlib.Path(venv)
    binp = root / "bin"
    python = str(binp / "python")

    targets = [root / "pyvenv.cfg"]
    if binp.is_dir():
        targets += sorted(binp.iterdir())

    changed = []
    for f in targets:
        if f.is_symlink() or not f.is_file():
            continue
        try:
            data = f.read_text()
        except (UnicodeDecodeError, PermissionError, OSError):
            continue  # binary (python3.11, ruff, ...) or unreadable
        if old not in data:
            continue

        lines = data.split("\n")
        if lines[0].startswith("#!") and old in lines[0] and "python" in lines[0]:
            # direct shebang into the old venv -> space-safe polyglot wrapper
            data = polyglot(python) + "\n".join(lines[1:]).replace(old, new)
        else:
            # pyvenv.cfg, activate*, or an already-polyglot wrapper
            data = data.replace(old, new)

        f.write_text(data)
        changed.append(f.name)

    print("%s: %d file(s) repaired" % (venv, len(changed)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
