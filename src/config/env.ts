import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { ConfigError } from '../utils/errors.js';

// Carrega o arquivo .env (se existir) antes de validar.
loadDotenv();

/** Converte "1,2, 3" em [1, 2, 3] de forma tolerante. */
const numberList = z
  .string()
  .optional()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => Number(v)),
  )
  .pipe(z.array(z.number().int()));

/** Converte "true"/"false"/"1"/"0" em boolean. */
const boolFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return defaultValue;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // -------------------------- Telegram --------------------------
    TELEGRAM_BOT_TOKEN: z
      .string({ required_error: 'TELEGRAM_BOT_TOKEN é obrigatório.' })
      .min(10, 'TELEGRAM_BOT_TOKEN parece inválido.'),
    TELEGRAM_MODE: z.enum(['polling', 'webhook']).default('polling'),
    TELEGRAM_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional().default(''),
    TELEGRAM_ALLOWED_USER_IDS: numberList,
    TELEGRAM_ALLOWED_CHAT_IDS: numberList,

    // --------------------------- Multica --------------------------
    MULTICA_API_BASE_URL: z
      .string({ required_error: 'MULTICA_API_BASE_URL é obrigatório.' })
      .url('MULTICA_API_BASE_URL deve ser uma URL válida.'),
    MULTICA_WS_URL: z.string().optional().default(''),
    MULTICA_API_TOKEN: z
      .string({ required_error: 'MULTICA_API_TOKEN é obrigatório.' })
      .min(8, 'MULTICA_API_TOKEN parece inválido.'),
    MULTICA_WORKSPACE_SLUG: z
      .string({ required_error: 'MULTICA_WORKSPACE_SLUG é obrigatório.' })
      .min(1, 'MULTICA_WORKSPACE_SLUG é obrigatório.'),
    MULTICA_WORKSPACE_ID: z.string().optional().default(''),

    // ---------------------------- Bridge --------------------------
    BRIDGE_PUBLIC_URL: z.string().optional().default(''),
    BRIDGE_PORT: z.coerce.number().int().positive().default(3333),
    BRIDGE_LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),
    BRIDGE_TIMEZONE: z.string().default('America/Sao_Paulo'),
    BRIDGE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    BRIDGE_ENABLE_WEBSOCKET: boolFromString(true),
    BRIDGE_ENABLE_POLLING_FALLBACK: boolFromString(true),
    BRIDGE_POLLING_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
    BRIDGE_NOTIFICATION_CHAT_ID: z.string().optional().default(''),

    // --------------------------- Segurança ------------------------
    BRIDGE_REQUIRE_EXPLICIT_MENTION: boolFromString(true),
    BRIDGE_ALLOW_GROUP_MESSAGES: boolFromString(true),
    BRIDGE_MAX_MESSAGE_LENGTH: z.coerce.number().int().positive().default(3500),
    BRIDGE_COMMAND_PREFIX: z.string().default('/'),
    BRIDGE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),

    // ------------------------ Storage opcional --------------------
    DATABASE_URL: z.string().optional().default(''),
    REDIS_URL: z.string().optional().default(''),
  })
  .superRefine((env, ctx) => {
    // Pelo menos um usuário autorizado é obrigatório (segurança).
    if (env.TELEGRAM_ALLOWED_USER_IDS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEGRAM_ALLOWED_USER_IDS'],
        message: 'TELEGRAM_ALLOWED_USER_IDS é obrigatório (ao menos um ID).',
      });
    }
    // Em modo webhook a URL pública é obrigatória.
    if (env.TELEGRAM_MODE === 'webhook' && !env.TELEGRAM_WEBHOOK_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEGRAM_WEBHOOK_URL'],
        message: 'TELEGRAM_WEBHOOK_URL é obrigatório quando TELEGRAM_MODE=webhook.',
      });
    }
    // Se WebSocket habilitado, a URL precisa estar configurada.
    if (env.BRIDGE_ENABLE_WEBSOCKET && !env.MULTICA_WS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MULTICA_WS_URL'],
        message: 'MULTICA_WS_URL é obrigatório quando BRIDGE_ENABLE_WEBSOCKET=true.',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Valida e retorna a configuração da aplicação.
 * Em caso de erro, lança ConfigError com mensagem clara — o serviço
 * deve falhar no startup (conforme CA-04).
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problemas = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(
      `Configuração inválida. Corrija as variáveis de ambiente:\n${problemas}`,
      '⚠️ O bridge não pôde iniciar por configuração inválida.',
    );
  }

  return result.data;
}
