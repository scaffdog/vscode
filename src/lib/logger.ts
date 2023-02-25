import * as vscode from 'vscode';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE';

const DEFAULT_LOG_LEVEL: LogLevel = 'INFO';

const logLevel = new Map<LogLevel, number>([
  ['NONE', 0],
  ['ERROR', 1],
  ['WARN', 2],
  ['INFO', 3],
  ['DEBUG', 4],
]);

const getLevelValue = (level: LogLevel) => logLevel.get(level)!;

export type LogFn = (message: string, data?: unknown) => void;

export type Logger = {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  setLevel: (level: LogLevel) => void;
  show: () => void;
};

export const createLogger = (): Logger => {
  const level: {
    name: LogLevel;
    value: number;
  } = {
    name: DEFAULT_LOG_LEVEL,
    value: getLevelValue(DEFAULT_LOG_LEVEL),
  };

  const ch = vscode.window.createOutputChannel('scaffdog');

  const log = {
    message: (level: LogLevel, message: string) => {
      const ts = new Date().toLocaleTimeString();
      ch.appendLine(`${ts} [${level}] ${message}`);
    },
    object: (data: unknown) => {
      ch.appendLine(JSON.stringify(data, null, 2));
    },
  };

  return {
    debug: (message, data) => {
      if (getLevelValue('DEBUG') <= level.value) {
        log.message('DEBUG', message);
        if (data !== undefined) {
          log.object(data);
        }
      }
    },

    info: (message, data) => {
      if (getLevelValue('INFO') <= level.value) {
        log.message('INFO', message);
        if (data !== undefined) {
          log.object(data);
        }
      }
    },

    warn: (message, data) => {
      if (getLevelValue('WARN') <= level.value) {
        log.message('WARN', message);
        if (data !== undefined) {
          log.object(data);
        }
      }
    },

    error: (message, data) => {
      if (getLevelValue('ERROR') <= level.value) {
        log.message('ERROR', message);
        if (typeof data === 'string') {
          ch.appendLine(data);
        } else if (data instanceof Error) {
          if (data?.message) {
            log.message('ERROR', data.message);
          }
          if (data?.stack) {
            ch.appendLine(data.stack);
          }
        } else if (data !== undefined) {
          log.object(data);
        }
      }
    },

    setLevel: (next) => {
      level.name = next;
      level.value = getLevelValue(next);
    },

    show: () => {
      ch.show();
    },
  };
};
