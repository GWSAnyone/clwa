/**
 * Серверные дефолты для LLM-роутера.
 *
 * Все доменные строки (имя модели Qwen, embedding-модель, дефолтные температуры
 * по task'у) живут ЗДЕСЬ, не в engine. Engine не знает ни одной строки с
 * провайдер-id, model-id или URL — это домен server'а, как и регистрация модулей.
 *
 * buildDefaultRouter() — pure-default router (если worldData.config.llm не задан).
 * migrateLegacyWorldConfig(cfg) — soft migration для старых WorldConfig.lmStudioUrl/model.
 */

import type { LlmRouterConfig, WorldConfig } from '@clwa/engine';

const DEFAULT_LM_STUDIO_MODEL = 'qwen3.5-9b-abliterated';
const DEFAULT_EMBED_MODEL = 'text-embedding-nomic-embed-text-v1.5@q8_0';

/**
 * Полный pure-default router — собирается если ни WorldConfig.llm, ни legacy fields не заданы.
 * Все task'и роутятся на 'lm-studio' (локальный qwen). После регистрации
 * ClaudeCodeProvider'а в server'е можно по-task'но переключать на 'claude-code' через
 * worldData.config.llm.routes.<task> override.
 */
export function buildDefaultRouter(): LlmRouterConfig {
  return {
    default: {
      provider: 'lm-studio',
      model: DEFAULT_LM_STUDIO_MODEL,
      sampling: { temperature: 0.7 },
    },
    routes: {
      volition: {
        provider: 'lm-studio',
        model: DEFAULT_LM_STUDIO_MODEL,
        maxTokens: 100,
        sampling: { temperature: 0.35 },
      },
      il: {
        provider: 'lm-studio',
        model: DEFAULT_LM_STUDIO_MODEL,
        maxTokens: 400,
        sampling: { temperature: 0.15 },
      },
      reflection: {
        provider: 'lm-studio',
        model: DEFAULT_LM_STUDIO_MODEL,
        maxTokens: 150,
        sampling: { temperature: 0.7 },
      },
      dialogue: {
        provider: 'lm-studio',
        model: DEFAULT_LM_STUDIO_MODEL,
        maxTokens: 250,
        sampling: {
          temperature: 0.7,
          repeatPenalty: 1.1,
          frequencyPenalty: 0.3,
          presencePenalty: 0.2,
        },
      },
      'npc-dialogue': {
        provider: 'lm-studio',
        model: DEFAULT_LM_STUDIO_MODEL,
        maxTokens: 200,
        sampling: { temperature: 0.7 },
      },
      verdict: {
        // Claude Sonnet через `-p` cold spawn. Verdict редок (1–5/игра) и требует качественной
        // judicial reasoning. Sonnet >> Haiku по proportionality (Haiku даёт fine на всё подряд,
        // Sonnet корректно различает warning/fine/imprisonment/exile). Стоимость ~$0.07/verdict.
        provider: 'claude-code',
        model: 'sonnet',
        maxTokens: 800,
        sampling: { temperature: 0.4 },
        fallback: {
          provider: 'lm-studio',
          model: DEFAULT_LM_STUDIO_MODEL,
          maxTokens: 300,
          sampling: { temperature: 0.4 },
        },
      },
      embeddings: {
        provider: 'lm-studio',
        model: DEFAULT_EMBED_MODEL,
      },
    },
  };
}

/**
 * @deprecated Удалено в Stage 4. WorldConfig.lmStudioUrl/model больше не существуют.
 * Используйте worldData.config.llm для override маршрутов или buildDefaultRouter().
 */
export function migrateLegacyWorldConfig(_cfg: WorldConfig): LlmRouterConfig | null {
  return null;
}
