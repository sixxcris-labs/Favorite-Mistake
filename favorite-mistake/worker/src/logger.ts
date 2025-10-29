import winston from 'winston';

export function createLogger(): winston.Logger {
  return winston.createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(info => `${info.timestamp} [${info.level}] ${info.message}`)
    ),
    transports: [new winston.transports.Console()]
  });
}
