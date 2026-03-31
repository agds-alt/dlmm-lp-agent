/**
 * Logger Utility
 * Simple console logging with timestamps and levels
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_MAP: { [key: string]: LogLevel } = {
  'debug': LogLevel.DEBUG,
  'info': LogLevel.INFO,
  'warn': LogLevel.WARN,
  'error': LogLevel.ERROR,
};

class Logger {
  private currentLevel: LogLevel;

  constructor(level: string = 'info') {
    this.currentLevel = LOG_LEVEL_MAP[level.toLowerCase()] || LogLevel.INFO;
  }

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;

    if (args.length > 0) {
      return `${prefix} ${message} ${JSON.stringify(args, null, 2)}`;
    }

    return `${prefix} ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.currentLevel <= LogLevel.DEBUG) {
      console.debug(this.formatMessage('DEBUG', message, ...args));
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.currentLevel <= LogLevel.INFO) {
      console.info(this.formatMessage('INFO', message, ...args));
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.currentLevel <= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN', message, ...args));
    }
  }

  error(message: string, error?: any): void {
    if (this.currentLevel <= LogLevel.ERROR) {
      console.error(this.formatMessage('ERROR', message));
      if (error) {
        console.error('Error details:', error);
        if (error.stack) {
          console.error('Stack trace:', error.stack);
        }
      }
    }
  }

  success(message: string, ...args: any[]): void {
    console.log(`✅ ${this.formatMessage('SUCCESS', message, ...args)}`);
  }

  setLevel(level: string): void {
    this.currentLevel = LOG_LEVEL_MAP[level.toLowerCase()] || LogLevel.INFO;
  }
}

// Singleton instance
export const logger = new Logger(process.env.LOG_LEVEL || 'info');

export default logger;
