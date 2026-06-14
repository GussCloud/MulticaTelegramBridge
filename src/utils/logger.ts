import { pino } from 'pino';

/**
 * Logger estruturado baseado em pino.
 *
 * Regras de segurança aplicadas via `redact`:
 * - Nunca expor tokens, headers de autenticação ou segredos.
 * - Os caminhos abaixo são removidos/censurados automaticamente caso
 *   algum objeto logado contenha essas chaves.
 */
const REDACT_PATHS = [
  'token',
  'authorization',
  'Authorization',
  'headers.authorization',
  'headers.Authorization',
  '*.token',
  '*.authorization',
  'TELEGRAM_BOT_TOKEN',
  'MULTICA_API_TOKEN',
  'config.TELEGRAM_BOT_TOKEN',
  'config.MULTICA_API_TOKEN',
  'env.TELEGRAM_BOT_TOKEN',
  'env.MULTICA_API_TOKEN',
];

const level = process.env.BRIDGE_LOG_LEVEL ?? 'info';
const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level,
  redact: {
    paths: REDACT_PATHS,
    censor: '***REDACTED***',
  },
  // Em produção mantemos JSON estruturado; em dev usamos pino-pretty se disponível.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
});

/**
 * Mascara um segredo deixando apenas os últimos caracteres visíveis.
 * Útil para registrar de forma segura qual token está em uso.
 */
export function maskSecret(value: string | undefined, visible = 4): string {
  if (!value) return '(vazio)';
  if (value.length <= visible) return '***';
  return `***${value.slice(-visible)}`;
}

export type Logger = typeof logger;
