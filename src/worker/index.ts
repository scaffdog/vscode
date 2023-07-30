import { createHelper, extendContext, render } from '@scaffdog/engine';
import * as path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import * as scaffdog from 'scaffdog';
import * as semver from 'semver';
import { createWorkerConnector } from '../shared/connection.js';
import { MIN_SCAFFDOG_VERSION } from '../shared/constants.js';
import { PromptCancelError } from '../shared/errors.js';
import {
  ModuleSpecifier,
  ScaffdogMessage,
  scaffdogGeneratePromptResponseSchema,
  scaffdogGenerateRequestSchema,
  scaffdogImportRequestSchema,
  scaffdogListRequestSchema,
} from '../shared/types.js';
import { createConsoleLogger } from '../shared/logger.js';

const BUNDLE_SPECIFY = '__BUNDLE_SPECIFY__';
const DEBUG = workerData === true;

const logger = createConsoleLogger(DEBUG);

const moduleCache = new Map<string, typeof scaffdog>();
const apiCache = new Map<string, scaffdog.Scaffdog>();

const questionIf = createHelper<[any]>((_, result) => {
  if (typeof result === 'boolean') {
    return result ? 'true' : 'false';
  }
  throw new Error(
    'evaluation value of "questions.*.if" must be a boolean value',
  );
});

const confirmIf = (question: scaffdog.Question, context: scaffdog.Context) => {
  if (question.if !== undefined) {
    if (typeof question.if === 'boolean') {
      return question.if;
    }

    const fn = '__internal_question_if__';
    const ctx = extendContext(context, {
      helpers: new Map([[fn, questionIf]]),
    });

    return render(`{{ ${fn}(${question.if}) }}`, ctx) === 'true';
  }

  return true;
};

const getInitialValue = (question: scaffdog.Question) => {
  switch (question.type) {
    case 'confirm':
      return question.initial ?? false;
    case 'checkbox':
      return question.initial ?? [];
    case 'list':
      return question.initial ?? '';
    default:
      return question.initial ?? '';
  }
};

const loadProject = async (
  fn: scaffdog.ScaffdogLoader,
  patterns: string[],
  dir: string,
): Promise<scaffdog.Scaffdog> => {
  const key = dir + patterns;

  if (apiCache.has(key)) {
    return apiCache.get(key)!;
  }

  let result: scaffdog.Scaffdog | null = null;

  for (const pattern of patterns) {
    try {
      result = await fn(path.join(dir, pattern.trim()), {
        cwd: dir,
      });
      apiCache.set(key, result);
      break;
    } catch (e) {}
  }

  if (result === null) {
    const next = path.resolve(dir, '..');
    if (
      next === dir ||
      next.split(path.sep).length < dir.split(path.sep).length
    ) {
      throw new Error('Cannot resolve scaffdog project!');
    }
    return loadProject(fn, patterns, next);
  }

  return result;
};

const load = async (
  specifier: ModuleSpecifier | null,
  project: string,
  root: string,
) => {
  const mod = moduleCache.get(specifier ?? BUNDLE_SPECIFY)!;
  const patterns = project.split(',');
  return await loadProject(mod.loadScaffdog, patterns, root);
};

const main = async () => {
  const port = parentPort!;
  const connector = createWorkerConnector(port, DEBUG);
  let exit = false;

  port.on('close', () => {
    exit = true;
  });

  while (true) {
    if (exit) {
      break;
    }

    const conn = await connector.wait<ScaffdogMessage>();

    const result = await conn.receiveAny();
    if (result.state === 'failure') {
      logger.error('receiveAny error', result.error);
      continue;
    }

    switch (result.method) {
      case 'import': {
        const body = scaffdogImportRequestSchema.parse(result.body);

        const bundle = {
          type: 'bundle',
          version: scaffdog.version,
        } as const;

        // cache
        const key = body.specifier ?? BUNDLE_SPECIFY;
        const cache = moduleCache.get(key);
        if (cache !== undefined) {
          conn.send(
            'import',
            {
              type: body.specifier !== null ? 'local' : 'bundle',
              version: cache.version,
            },
            null,
          );
          continue;
        }

        // local module
        if (body.specifier !== null) {
          try {
            const mod = await import(body.specifier);
            if (semver.gte(mod.version, MIN_SCAFFDOG_VERSION)) {
              moduleCache.set(body.specifier, mod);
              conn.send(
                'import',
                {
                  type: 'local',
                  version: mod.version,
                },
                null,
              );
              continue;
            } else {
              moduleCache.set(body.specifier, scaffdog);
              conn.send('import', bundle, null);
              continue;
            }
          } catch (e) {}
        }

        // bundle module
        moduleCache.set(BUNDLE_SPECIFY, scaffdog);
        conn.send('import', bundle, null);
        break;
      }

      case 'list': {
        try {
          const body = scaffdogListRequestSchema.parse(result.body);
          const api = await load(body.specifier, body.project, body.root);
          const documents = await api.list();
          conn.send('list', documents, null);
        } catch (e) {
          if (e instanceof Error && 'errors' in e) {
            const msg = (e.errors as Error[])
              .map((err) => err.message)
              .join(', ');
            e.message = `${e.message} (${msg})`;
          }
          conn.send('list', null, e);
        }
        break;
      }

      case 'generate': {
        try {
          const body = scaffdogGenerateRequestSchema.parse(result.body);
          const api = await load(body.specifier, body.project, body.root);

          const files = await api.generate(
            body.document as scaffdog.Document,
            body.output,
            {
              inputs: async (context) => {
                const inputs = Object.create(null);
                const total = body.document.questions.size;
                if (total === 0) {
                  return inputs;
                }

                let step = 0;

                for (const [
                  name,
                  question,
                ] of body.document.questions.entries()) {
                  step++;

                  const ctx = extendContext(context, {
                    variables: new Map([['inputs', inputs]]),
                  });

                  if (confirmIf(question, ctx)) {
                    conn.send(
                      'generate',
                      {
                        kind: 'prompt',
                        title: question.message,
                        step,
                        total,
                        question,
                      },
                      null,
                    );

                    const result = await conn.receive('generate');
                    if (result.state === 'failure') {
                      throw new Error(`Inputs error (${result.error.message})`);
                    }
                    const { cancel, value } =
                      scaffdogGeneratePromptResponseSchema.parse(result.body);

                    if (cancel) {
                      throw new PromptCancelError();
                    }

                    inputs[name] = value;
                  } else {
                    inputs[name] = getInitialValue(question);
                  }
                }

                return inputs;
              },
            },
          );

          conn.send(
            'generate',
            {
              kind: 'main',
              files,
            },
            null,
          );
        } catch (e) {
          if (e instanceof PromptCancelError) {
            // noop (should be closed by the host thread)
          } else {
            logger.error('scaffdog.generate error', e);
            conn.send('generate', null, e);
          }
        }
        break;
      }
    }
  }
};

main().catch((e) => logger.error('Worker Thread Error', e));
