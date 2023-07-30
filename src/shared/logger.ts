import { isMainThread } from 'node:worker_threads';

export type ConsoleLogFn = (title: string, ...args: unknown[]) => void;

export type ConsoleLogger = {
  debug: ConsoleLogFn;
  error: ConsoleLogFn;
};

const LOCALES = ['MAIN', 'WORKER'];
const LOCALE_LENGTH = LOCALES.reduce(
  (acc, cur) => Math.max(acc, cur.length),
  0,
);

export const createConsoleLogger = (enable: boolean): ConsoleLogger => {
  const prefix = (type: string, title: string) => {
    const locale = (isMainThread ? LOCALES[0] : LOCALES[1]).padStart(
      LOCALE_LENGTH,
    );
    return `${locale} [${type}] ${title}:`;
  };

  return {
    debug: (title, ...args) => {
      if (enable) {
        console.log(prefix('DEBUG', title), ...args);
      }
    },

    error: (title, ...args) => {
      if (enable) {
        console.error(prefix('ERROR', title), ...args);
      }
    },
  };
};
