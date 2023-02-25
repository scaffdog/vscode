import { findUpSync } from 'find-up';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as resolve from 'resolve';
import { Logger } from './logger';

/* eslint-disable */
declare const __webpack_require__: typeof require;
declare const __non_webpack_require__: typeof require;
const getRequire = () =>
  typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;
/* eslint-enable */

export type ModuleLibrary = {
  clear: () => void;
  loadModule: <T>(m: string) => T | null;
  findPackage: (root: string, pkg: string) => string | null;
};

export const createModuleLibrary = (logger: Logger): ModuleLibrary => {
  const require = getRequire();
  const cache = new Map<string, string>();

  return {
    loadModule: (m) => {
      try {
        return require(m);
      } catch (e) {
        logger.debug(`Module load error ("${(e as Error).message}")`);
        return null;
      }
    },

    findPackage: (root, pkg) => {
      const key = `${root}:${pkg}`;
      const fromCache = cache.get(key);
      if (fromCache !== undefined) {
        return fromCache;
      }

      const basedir = findUpSync(
        (dir) => {
          try {
            const filename = path.join(dir, 'package.json');
            logger.debug(`Finding ${pkg} ... "${filename}"`);

            const stat = fs.statSync(filename);
            if (!stat.isFile()) {
              return;
            }

            const json = JSON.parse(fs.readFileSync(filename, 'utf8'));
            if (json?.dependencies?.[pkg] || json?.devDependencies?.[pkg]) {
              return dir;
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : e;
            logger.debug(`Find ${pkg} match error ("${msg}")`);
            return;
          }
        },
        {
          cwd: root,
          type: 'directory',
        },
      );

      logger.debug(`Found package basedir = "${basedir}"`);

      if (basedir === undefined) {
        return null;
      }

      try {
        const result = resolve.sync(pkg, { basedir });
        cache.set(key, result);
        return result;
      } catch (e) {
        logger.error('Find package error', e);
        return null;
      }
    },

    clear: () => {
      cache.clear();
    },
  };
};
