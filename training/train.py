"""
CLWA LoRA Training Script
Unsloth QLoRA on Qwen3.5-9B-abliterated
RTX 3080 10GB — 4-bit loading (~7.1 GB VRAM)
"""

from unsloth import FastLanguageModel
from datasets import Dataset
import json
import os

# ============================================================
# CONFIG
# ============================================================

MODEL_PATH = "C:/Ledevia/Projects/Models/Qwen3.5-9B-abliterated"
DATASET_PATH = "C:/Ledevia/Projects/CLWA/training/dataset/output/clwa-v1.jsonl"
OUTPUT_DIR = "C:/Ledevia/Projects/CLWA/training/output/clwa-lora-v1"

MAX_SEQ_LENGTH = 2048
LOAD_IN_4BIT = True

# LoRA config
LORA_R = 16
LORA_ALPHA = 32
LORA_DROPOUT = 0.05
TARGET_MODULES = [
    "q_proj", "k_proj", "v_proj", "o_proj",
    "gate_proj", "up_proj", "down_proj",
]

# Training config
EPOCHS = 3
BATCH_SIZE = 1  # RTX 3080 10GB constraint
GRADIENT_ACCUMULATION = 4  # effective batch = 4
LEARNING_RATE = 2e-4
WARMUP_RATIO = 0.1
LR_SCHEDULER = "cosine"
LOGGING_STEPS = 10
SAVE_STEPS = 100

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

print(f"Model loaded. Adding LoRA adapters (r={LORA_R})...")

model = FastLanguageModel.get_peft_model(
    model,
    r=LORA_R,
    lora_alpha=LORA_ALPHA,
    lora_dropout=LORA_DROPOUT,
    target_modules=TARGET_MODULES,
    bias="none",
    use_gradient_checkpointing="unsloth",  # memory optimization
)

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

print(f"Dataset formatted. Sample length: {len(dataset[0]['text'])} chars")
print(f"Sample preview:\n{dataset[0]['text'][:500]}...")

# ============================================================
# TRAIN
# ============================================================

from trl import SFTTrainer
from transformers import TrainingArguments

print(f"\n{'=' * 50}")
print(f"Starting training")
print(f"  Epochs: {EPOCHS}")
print(f"  Batch size: {BATCH_SIZE} (effective: {BATCH_SIZE * GRADIENT_ACCUMULATION})")
print(f"  Learning rate: {LEARNING_RATE}")
print(f"  Total steps: ~{len(dataset) * EPOCHS // (BATCH_SIZE * GRADIENT_ACCUMULATION)}")
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
    packing=False,
)

print("Training...")
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

# ============================================================
# EXPORT GGUF (optional, run separately if needed)
# ============================================================

print(f"\nTo export GGUF, run:")
print(f"  python training/export-gguf.py")
print(f"\nTo test the model in LM Studio:")
print(f"  1. Load the GGUF in LM Studio")
print(f"  2. Run: bun run packages/server/src/index.ts")
print(f"  3. Watch NPC decisions")
