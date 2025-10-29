import winston from 'winston';

export function jitterDelay(baseMs: number): number {
  const jitter = Math.random() * baseMs * 0.2;
  return baseMs + jitter;
}

export async function applyStealth<T>(
  label: string,
  work: () => Promise<T>,
  logger: winston.Logger,
  baseDelay = 250
): Promise<T> {
  const delay = jitterDelay(baseDelay);
  await new Promise(resolve => setTimeout(resolve, delay));
  logger.debug(`Stealth delay applied (${label}): ${delay.toFixed(0)}ms`);
  return work();
}
