const winston = require('winston');
const { getEnv, runtime } = require('./env');

const isProduction = runtime === 'production';

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${stack || message}${extra}`;
  })
);

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.metadata({
    fillExcept: ['timestamp', 'level', 'message', 'stack'],
  }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: getEnv('LOG_LEVEL', isProduction ? 'info' : 'debug'),
  defaultMeta: {
    service: 'cine-stream-backend',
    env: runtime,
  },
  format: isProduction ? jsonFormat : consoleFormat,
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false,
});

module.exports = logger;
