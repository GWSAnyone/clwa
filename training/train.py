"""
CLWA LoRA Training Script
Unsloth QLoRA on Qwen3.5-9B-abliterated
RTX 3080 10GB — 4-bit loading (~7.1 GB VRAM)

Optimized for 10GB VRAM:
- Standard CE loss instead of fused (fused OOMs on 151K vocab)
- r=8 LoRA rank (behavioral fine-tuning, not knowledge injection)
- packing=True (short examples packed efficiently)
- gradient_accumulation=8 (fewer optimizer updates, same data)
"""

import os
os.environ["UNSLOTH_DISABLE_FUSED_CE"] = "1"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True,max_split_size_mb:128,garbage_collection_threshold:0.6"
os.environ["TORCHDYNAMO_DISABLE"] = "1"  # disable torch.compile — saves ~2-4 GB VRAM from compiled graph caches
# expandable_segments — VRAM блоки могут расширяться, меньше фрагментация
# max_split_size_mb:128 — не дробить блоки крупнее 128MB, лучше reuse
# garbage_collection_threshold:0.6 — при 60% занятости VRAM начинать сборку мусора (дефолт слишком поздно для 10GB)

from unsloth import FastLanguageModel
from datasets import Dataset
import json
import torch

# ============================================================
# CONFIG
# ============================================================

MODEL_PATH = "C:/Ledevia/Projects/Models/Qwen3.5-9B-abliterated"
DATASET_PATH = "C:/Ledevia/Projects/CLWA/training/dataset/output/clwa-v1.jsonl"
OUTPUT_DIR = "C:/Ledevia/Projects/CLWA/training/output/clwa-lora-v1"

MAX_SEQ_LENGTH = 768   # all examples ≤703 tokens, 768 covers 100%
LOAD_IN_4BIT = True

# LoRA config — r=8 sufficient for behavioral fine-tuning
LORA_R = 8
LORA_ALPHA = 16         # alpha = 2×r
LORA_DROPOUT = 0        # 0 for Unsloth fast patching
TARGET_MODULES = [
    "q_proj", "k_proj", "v_proj", "o_proj",
    "gate_proj", "up_proj", "down_proj",
]

# Training config
EPOCHS = 3
BATCH_SIZE = 1           # RTX 3080 10GB constraint
GRADIENT_ACCUMULATION = 8  # effective batch = 8
LEARNING_RATE = 2e-4
WARMUP_RATIO = 0.1
LR_SCHEDULER = "cosine"
LOGGING_STEPS = 10
SAVE_STEPS = 10

# ============================================================
# LOAD MODEL
# ============================================================

print("=" * 50)
print("Loading model (4-bit)...")
print("=" * 50)

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_PATH,
    max_seq_length=MAX_SEQ_LENGTH,
    load_in_4bit=LOAD_IN_4BIT,
)

# Fix: abliterated models may lack chat_template
if not getattr(tokenizer, 'chat_template', None):
    print("WARNING: No chat_template found. Setting Qwen3.5 ChatML template...")
    tokenizer.chat_template = (
        "{% for message in messages %}"
        "{{'<|im_start|>' + message['role'] + '\n' + message['content'] + '<|im_end|>' + '\n'}}"
        "{% endfor %}"
        "{% if add_generation_prompt %}"
        "{{'<|im_start|>assistant\n'}}"
        "{% endif %}"
    )

print(f"Model loaded. Adding LoRA adapters (r={LORA_R})...")

model = FastLanguageModel.get_peft_model(
    model,
    r=LORA_R,
    lora_alpha=LORA_ALPHA,
    lora_dropout=LORA_DROPOUT,
    target_modules=TARGET_MODULES,
    bias="none",
    use_gradient_checkpointing="unsloth",
)

# ============================================================
# PATCH: Replace fused CE with standard CE in compiled module
# ============================================================
# Fused CE with 151K vocab OOMs on 10GB. Standard CE needs ~660MB
# for batch=1, seq=768, vocab=151K — fits in remaining ~2.9GB.
# Must patch AFTER model load (Unsloth compiles on load).

print("Patching fused CE loss → standard CrossEntropyLoss...")

def _standard_ce_loss(
    trainer=None, hidden_states=None, lm_head_weight=None,
    lm_head_bias=None, labels=None, mask=None, n_items=None,
    scaling=None, target_gb=None, torch_compile=None,
    logit_scale_multiply=0, logit_scale_divide=0, logit_softcapping=0,
    **kwargs,
):
    """Standard CE loss — replaces Unsloth fused CE for low VRAM."""
    logits = torch.nn.functional.linear(hidden_states, lm_head_weight, lm_head_bias)
    shift_logits = logits[..., :-1, :].contiguous()
    shift_labels = labels[..., 1:].contiguous()
    loss = torch.nn.functional.cross_entropy(
        shift_logits.view(-1, shift_logits.size(-1)),
        shift_labels.view(-1),
        ignore_index=-100,
    )
    return loss

# Patch in the compiled module namespace (where forward() looks up the function)
try:
    import importlib
    mod = importlib.import_module("unsloth_compiled_cache.unsloth_compiled_module_qwen3_5")
    mod.unsloth_fused_ce_loss = _standard_ce_loss
    print("  → Patched compiled module namespace")
except Exception as e:
    print(f"  → Could not patch compiled module: {e}")

# Also patch the source module (for any other callers)
try:
    import unsloth_zoo.fused_losses.cross_entropy_loss as ce_mod
    ce_mod.unsloth_fused_ce_loss = _standard_ce_loss
    print("  → Patched unsloth_zoo namespace")
except Exception as e:
    print(f"  → Could not patch unsloth_zoo: {e}")

print("CE loss patching complete.")

# ============================================================
# LOAD DATASET
# ============================================================

print(f"\nLoading dataset from {DATASET_PATH}...")

examples = []
with open(DATASET_PATH, 'r', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if line:
            examples.append(json.loads(line))

print(f"Loaded {len(examples)} examples")

# Convert to chat format using tokenizer
def format_example(example):
    """Apply chat template to messages."""
    messages = example["messages"]
    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=False,
    )
    return {"text": text}

dataset = Dataset.from_list(examples)
dataset = dataset.map(format_example, remove_columns=dataset.column_names)

print(f"Dataset formatted. {len(dataset)} examples.")

# ============================================================
# TRAIN
# ============================================================

from trl import SFTTrainer
from transformers import TrainingArguments

print(f"\n{'=' * 50}")
print(f"Starting training")
print(f"  Epochs: {EPOCHS}")
print(f"  LoRA rank: {LORA_R}")
print(f"  Batch size: {BATCH_SIZE} (effective: {BATCH_SIZE * GRADIENT_ACCUMULATION})")
print(f"  Learning rate: {LEARNING_RATE}")
print(f"  Packing: True")
print(f"  Max seq length: {MAX_SEQ_LENGTH}")
print(f"{'=' * 50}\n")

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    args=TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRADIENT_ACCUMULATION,
        learning_rate=LEARNING_RATE,
        warmup_ratio=WARMUP_RATIO,
        lr_scheduler_type=LR_SCHEDULER,
        logging_steps=LOGGING_STEPS,
        save_steps=SAVE_STEPS,
        save_total_limit=2,
        fp16=False,
        bf16=True,
        optim="adamw_8bit",
        seed=42,
        report_to="none",
    ),
    dataset_text_field="text",
    max_seq_length=MAX_SEQ_LENGTH,
    packing=False,  # disabled — packing increases peak activation memory
)

print("Training...")
torch.cuda.empty_cache()  # free any leftover allocations before training
stats = trainer.train()

print(f"\n{'=' * 50}")
print(f"Training complete!")
print(f"  Total steps: {stats.global_step}")
print(f"  Training loss: {stats.training_loss:.4f}")
print(f"  Runtime: {stats.metrics['train_runtime']:.0f}s")
print(f"{'=' * 50}")

# Save LoRA adapters
print(f"\nSaving LoRA adapters to {OUTPUT_DIR}...")
model.save_pretrained(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)
print("Saved!")
