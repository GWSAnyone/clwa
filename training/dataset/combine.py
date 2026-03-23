"""Combines base + selected module JSONL files into a single training dataset."""
import json
import os
import random
import sys

def collect_files(base_dir, modules=None):
    """Collect all JSONL files from base + selected modules."""
    files = []

    # Always include base
    base_path = os.path.join(base_dir, 'base')
    for root, dirs, files_in_dir in os.walk(base_path):
        for f in sorted(files_in_dir):
            if f.endswith('.jsonl'):
                files.append(os.path.join(root, f))

    # Include selected modules
    if modules is None:
        modules = ['crime-justice']  # default

    for mod in modules:
        mod_path = os.path.join(base_dir, 'modules', mod)
        if not os.path.exists(mod_path):
            print(f"WARNING: Module '{mod}' not found at {mod_path}")
            continue
        for root, dirs, files_in_dir in os.walk(mod_path):
            for f in sorted(files_in_dir):
                if f.endswith('.jsonl'):
                    files.append(os.path.join(root, f))

    return files

def combine(base_dir, output_path, modules=None, shuffle=True, seed=42):
    """Merge all JSONL files into one, optionally shuffle."""
    files = collect_files(base_dir, modules)

    all_examples = []
    for fpath in files:
        rel = os.path.relpath(fpath, base_dir)
        with open(fpath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        count = 0
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
                all_examples.append(d)
                count += 1
            except json.JSONDecodeError as e:
                print(f"ERROR: Invalid JSON in {rel}: {e}")
        print(f"  {rel}: {count} examples")

    if shuffle:
        random.seed(seed)
        random.shuffle(all_examples)
        print(f"\nShuffled with seed={seed}")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        for ex in all_examples:
            f.write(json.dumps(ex, ensure_ascii=False) + '\n')

    print(f"\nOutput: {output_path}")
    print(f"Total: {len(all_examples)} examples")
    return len(all_examples)

if __name__ == '__main__':
    base_dir = os.path.dirname(os.path.abspath(__file__))
    output = os.path.join(base_dir, 'output', 'clwa-v1.jsonl')

    modules = sys.argv[1:] if len(sys.argv) > 1 else ['crime-justice']
    print(f"Combining: base + {modules}")
    print("=" * 50)
    combine(base_dir, output, modules)
