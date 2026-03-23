"""
Patch Qwen3.5 GGUF to disable thinking by default.

Problem: Qwen3.5 GGUF models think by default (<think> blocks).
LM Studio doesn't expose a toggle for third-party GGUFs.
The chat template has: `if enable_thinking is defined and enable_thinking is false`
which only triggers when LM Studio explicitly passes enable_thinking=false (it doesn't for non-stock models).

Solution: Same-length binary replace in the GGUF file.
Replace the condition with `if true` (padded with spaces to match length).
This makes the "no thinking" branch always execute.

Usage:
    python patch-gguf-thinking.py <path-to-gguf>

The script creates a .bak backup before patching.
"""

import sys
import shutil

def patch(path: str) -> None:
    with open(path, 'rb') as f:
        data = f.read()

    # Pattern: the jinja condition that gates thinking
    old = b"enable_thinking is defined and enable_thinking is false"

    count = data.count(old)
    if count == 0:
        # Maybe already patched or different template
        if b"if true" in data[data.rfind(b"enable_thinking")-100:] if b"enable_thinking" in data else b"":
            print("Already patched (found 'if true')")
        else:
            print("Pattern not found — this GGUF may use a different chat template")
        return

    if count > 1:
        print(f"Warning: found {count} occurrences, expected 1. Patching first only.")

    # Same-length replacement: pad with spaces
    # "enable_thinking is defined and enable_thinking is false" (55 bytes)
    # → "true                                                   " (55 bytes)
    # But we replace the whole "if <condition>" block for safety

    # Find the full "if" statement
    if_old = b"if enable_thinking is defined and enable_thinking is false"
    if_new = b"if true                                                   "

    assert len(if_old) == len(if_new), f"Length mismatch: {len(if_old)} vs {len(if_new)}"

    if data.count(if_old) == 1:
        # Backup
        backup = path + '.bak'
        shutil.copy2(path, backup)
        print(f"Backup: {backup}")

        patched = data.replace(if_old, if_new, 1)
        assert len(patched) == len(data), "File size changed — aborting!"

        with open(path, 'wb') as f:
            f.write(patched)
        print(f"PATCHED: thinking disabled by default")
        print(f"  Old: {if_old.decode()}")
        print(f"  New: {if_new.decode()}")
    else:
        print("Could not find exact 'if' pattern. Manual inspection needed.")

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(f"Usage: python {sys.argv[0]} <path-to-gguf>")
        sys.exit(1)
    patch(sys.argv[1])
