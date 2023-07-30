import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Document, File } from 'scaffdog';
import { createWorkerConnector } from '../shared/connection';
import { PromptCancelError } from '../shared/errors';
import {
  ModuleSpecifier,
  ScaffdogGenerateMessage,
  ScaffdogImportMessage,
  ScaffdogListMessage,
  scaffdogGeneratePromptRequestSchema,
  scaffdogGenerateResponseSchema,
  scaffdogImportResponseSchema,
  scaffdogListResponseSchema,
} from '../shared/types';
import { Logger } from './lib/logger';
import { PromptLibrary, PromptResult } from './lib/prompt';

export type ScaffdogAdapter = {
  dispose: () => void;
  import: (specifier: ModuleSpecifier) => Promise<{
    type: 'local' | 'bundle';
    version: string;
  }>;
  list: (payload: {
    specifier: ModuleSpecifier;
    project: string;
    root: string;
  }) => Promise<Document[]>;
  generate: (payload: {
    specifier: ModuleSpecifier;
    project: string;
    root: string;
    document: Document;
    output: string;
  }) => Promise<File[]>;
};

export const createScaffdogAdapter = (
  logger: Logger,
  prompt: PromptLibrary,
): ScaffdogAdapter => {
  const debug = logger.getLevel() === 'DEBUG';

  const worker = new Worker(path.join(__dirname, 'worker.mjs'), {
    workerData: debug,
  });

  const connector = createWorkerConnector(worker, debug);

  return {
    dispose: () => {
      connector.dispose();
      worker.unref();
    },

    import: async (specifier) => {
      const conn = await connector.connect<ScaffdogImportMessage>();

      conn.send(
        'import',
        {
          specifier,
        },
        null,
      );

      const result = await conn.receive('import');
      await conn.close();

      logger.debug('scaffdog.import result:', result);

      if (result.state === 'failure') {
        logger.error('import error:', result.error);
        throw new Error(`import error (${result.error})`);
      }

      return scaffdogImportResponseSchema.parse(result.body);
    },

    list: async ({ specifier, project, root }) => {
      const conn = await connector.connect<ScaffdogListMessage>();

      conn.send(
        'list',
        {
          specifier,
          project,
          root,
        },
        null,
      );

      const result = await conn.receive('list');
      await conn.close();

      if (result.state === 'failure') {
        logger.error('list error:', result.error);
        throw new Error(result.error.message);
      }

      const documents = scaffdogListResponseSchema.parse(result.body);

      return documents as Document[];
    },

    generate: async ({ specifier, project, root, document, output }) => {
      const conn = await connector.connect<ScaffdogGenerateMessage>();
      let files: File[] = [];

      conn.send(
        'generate',
        {
          kind: 'main',
          specifier,
          project,
          root,
          document,
          output,
        },
        null,
      );

      while (true) {
        const result = await conn.receive('generate');
        if (result.state === 'failure') {
          logger.error('generate error:', result.error);
          await conn.close();
          throw new Error(result.error.message);
        }
        if (result.body.kind === 'main') {
          logger.debug('generate result:', result.body);
          const body = scaffdogGenerateResponseSchema.parse(result.body);
          files = body.files;
          break;
        }
        if (result.body.kind === 'prompt') {
          logger.debug('prompt request:', result.body);
          const body = scaffdogGeneratePromptRequestSchema.parse(result.body);

          const opts = {
            title: body.title,
            total: body.total,
            step: body.step,
          };

          let res: PromptResult<boolean | string | string[]>;

          switch (body.question.type) {
            case 'confirm': {
              res = await prompt.confirm(opts);
              break;
            }

            case 'checkbox': {
              res = await prompt.select({
                ...opts,
                items: body.question.choices!,
                validate: (v) => (v.length > 0 ? null : 'required input!'),
              });
              break;
            }

            case 'list': {
              res = await prompt.list({
                ...opts,
                items: body.question.choices!,
                validate: (v) => (v !== '' ? null : 'required input!'),
              });
              break;
            }

            case 'input': {
              res = await prompt.input({
                ...opts,
                validate: (v) => (v !== '' ? null : 'required input!'),
              });
              break;
            }
          }

          logger.debug('prompt result:', res);

          if (res.state === 'failure') {
            conn.send(
              'generate',
              {
                kind: 'prompt',
                cancel: true,
                value: null,
              },
              null,
            );
            await conn.close();
            throw new PromptCancelError();
          } else {
            conn.send(
              'generate',
              {
                kind: 'prompt',
                cancel: false,
                value: res.value,
              },
              null,
            );
          }
        }
      }

      await conn.close();

      return files;
    },
  };
};
