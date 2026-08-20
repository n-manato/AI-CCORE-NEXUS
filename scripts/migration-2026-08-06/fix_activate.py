#!/usr/bin/env python3
"""Quote the venv path in activate scripts.

The plain text substitution that repointed these venvs left VIRTUAL_ENV holding
a bare path, which was fine at the old location but not at the new one: the path
now contains a space ("AICCORE Nexus"), so `source activate` would assign only
the first word. CPython's venv quotes the value whenever it contains a space --
this restores that form.

Usage: fix_activate.py <venv_dir> [<venv_dir> ...]
"""
import pathlib
import sys

# (filename, prefix that precedes the bare path on its line)
FORMS = [
    ("activate", "VIRTUAL_ENV="),
    ("activate.csh", "setenv VIRTUAL_ENV "),
    ("activate.fish", "set -gx VIRTUAL_ENV "),
]


def main() -> int:
    for venv in sys.argv[1:]:
        binp = pathlib.Path(venv) / "bin"
        for name, prefix in FORMS:
            f = binp / name
            if not f.is_file():
                continue
            out, touched = [], False
            for line in f.read_text().split("\n"):
                if line.startswith(prefix):
                    value = line[len(prefix):]
                    if value and value[0] not in "'\"":
                        line = "%s'%s'" % (prefix, value)
                        touched = True
                out.append(line)
            if touched:
                f.write_text("\n".join(out))
                print("quoted %s" % f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
