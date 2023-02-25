import { createHelper, extendContext, render } from '@scaffdog/engine';
import * as fs from 'node:fs';
import * as path from 'node:path';
import plur from 'plur';
import * as scaffdog from 'scaffdog';
import * as semver from 'semver';
import * as vscode from 'vscode';
import { getConfig } from '../config';
import { MIN_SCAFFDOG_VERSION } from '../constants';
import { Logger } from './logger';
import { ModuleLibrary } from './module';
import { PromptLibrary, PromptResult } from './prompt';

type ScaffdogPackage = typeof scaffdog;

class InputsCancelError extends Error {}

const isDirectory = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
};

const isFileExists = async (uri: vscode.Uri) => {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch (e) {
    return false;
  }
};

const count = (word: string, cnt: number) => `${cnt} ${plur(word, cnt)}`;

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

export type ScaffdogLibrary = vscode.Disposable & {
  register: (root: vscode.Uri) => vscode.Disposable[];
  runInSelectedFolder: (uri: vscode.Uri) => Promise<void>;
};

export const createScaffdogLibrary = (
  logger: Logger,
  mod: ModuleLibrary,
  prompt: PromptLibrary,
): ScaffdogLibrary => {
  const cache = new Map<string, scaffdog.Scaffdog>();
  let root: vscode.Uri | null = null;
  let config = getConfig();
  let pkg: ScaffdogPackage | null = null;
  let api: scaffdog.Scaffdog | null = null;

  const resolvePackage = (filename: string | null): ScaffdogPackage => {
    // local module
    if (filename !== null) {
      const m = mod.loadModule<ScaffdogPackage>(filename) ?? null;
      logger.debug(`Found module version: "${m?.version ?? 'notfound'}"`);
      if (
        m !== null &&
        semver.gte(m.version ?? '0.0.0', MIN_SCAFFDOG_VERSION)
      ) {
        logger.info(`Use local scaffdog module (version: "${m.version}")`);
        return m;
      }
    }

    // bundle module
    logger.info(`Use bundle scaffdog module (version: "${scaffdog.version}")`);

    vscode.window.showWarningMessage(
      `scaffdog requires a minimum "v${MIN_SCAFFDOG_VERSION}" version. Modules bundled in extensions were used instead of local modules.`,
    );

    return scaffdog;
  };

  const findProject = async (
    fn: scaffdog.ScaffdogLoader,
    dir: vscode.Uri,
  ): Promise<scaffdog.Scaffdog> => {
    const { project } = getConfig(root ?? undefined);
    const key = dir.path + project;

    if (cache.has(key)) {
      return cache.get(key)!;
    }

    let result: scaffdog.Scaffdog | null = null;
    const patterns = project.split(',');

    for (const pattern of patterns) {
      try {
        result = await fn(path.join(dir.fsPath, pattern.trim()), {
          cwd: dir.fsPath,
        });
        cache.set(key, result);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        logger.debug(`Find project error: "${msg}"`);
      }
    }

    if (result === null) {
      const next = path.resolve(dir.fsPath, '..');
      if (
        next === dir.fsPath ||
        next.split(path.sep).length < dir.fsPath.split(path.sep).length
      ) {
        throw new Error('Cannot resolve scaffdog project!');
      }
      return findProject(fn, vscode.Uri.file(next));
    }

    return result;
  };

  const buildInputs = async (
    context: scaffdog.Context,
    { questions }: scaffdog.Document,
  ) => {
    const inputs: scaffdog.VariableRecord = Object.create(null);
    const total = questions.size;
    if (total === 0) {
      return inputs;
    }

    let step = 0;

    for (const [name, question] of questions.entries()) {
      step++;

      const ctx = extendContext(context, {
        variables: new Map([['inputs', inputs]]),
      });

      if (confirmIf(question, ctx)) {
        const opts = {
          title: question.message,
          step,
          total,
        };

        let result: PromptResult<boolean | string | string[]>;

        switch (question.type) {
          case 'confirm': {
            result = await prompt.confirm(opts);
            break;
          }
          case 'checkbox': {
            result = await prompt.select({
              ...opts,
              items: question.choices,
              validate: (v) => (v.length > 0 ? null : 'required input!'),
            });
            break;
          }
          case 'list': {
            result = await prompt.list({
              ...opts,
              items: question.choices,
              validate: (v) => (v !== '' ? null : 'required input!'),
            });
            break;
          }
          default: {
            result = await prompt.input({
              ...opts,
              validate: (v) => (v !== '' ? null : 'required input!'),
            });
          }
        }

        if (result.state === 'failure') {
          throw new InputsCancelError();
        }

        inputs[name] = result.value;
      } else {
        inputs[name] = getInitialValue(question);
      }
    }

    return inputs;
  };

  const initialize = (dir: vscode.Uri) => {
    const filename = mod.findPackage(dir.fsPath, 'scaffdog');
    logger.debug(`Found module path: "${filename}"`);

    root = dir;
    config = getConfig(root);
    pkg = resolvePackage(filename);
  };

  const reset = () => {
    mod.clear();
    cache.clear();
    initialize(vscode.workspace.workspaceFolders![0].uri);
    logger.info('scaffdog reset!');
  };

  return {
    register: (dir) => {
      const cfg = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('scaffdog.enable')) {
          logger.warn(
            'To enable or disable scaffdog after changing the `enable` setting, you must re-start VS Code.',
          );
        } else if (e.affectsConfiguration('scaffdog')) {
          reset();
        }
      });

      root = dir;
      initialize(root);

      return [cfg];
    },

    runInSelectedFolder: async (selectedUri: vscode.Uri | undefined) => {
      if (root === null || pkg === null) {
        return;
      }

      // Resolve selected folder
      let uri = selectedUri;

      // Get focused explorer folder path
      // https://github.com/microsoft/vscode/issues/3553#issuecomment-1098562676
      if (uri === undefined) {
        const original = await vscode.env.clipboard.readText();
        await vscode.commands.executeCommand('copyFilePath');
        const folder = await vscode.env.clipboard.readText();
        await vscode.env.clipboard.writeText(original);
        if (!isDirectory(folder)) {
          logger.error(`"${folder}" is not folder path`);
          return;
        }
        uri = vscode.Uri.file(folder);
      }

      logger.debug(`Select path: "${uri.fsPath}"`);

      // Find project
      try {
        api = await findProject(pkg.loadScaffdog, root);
      } catch (e) {
        const msg = e instanceof Error ? ` (${e.message})` : '';
        logger.error('Error finding scaffdog project', e);
        vscode.window.showErrorMessage('Error finding scaffdog project' + msg);
        return;
      }

      let documents: scaffdog.Document[];
      try {
        documents = await api.list();
      } catch (e) {
        if (e instanceof pkg.ScaffdogAggregateError) {
          logger.error('Document parsing error', e.errors);
        } else {
          logger.error('Document parsing error', e);
        }
        return;
      }

      const name = await prompt.list({
        title: 'Please select a document:',
        items: documents.map((d) => ({
          value: d.name,
          description: [
            count('template', d.templates.length),
            count('question', d.questions.size),
          ].join(', '),
        })),
      });
      if (name.state === 'failure') {
        logger.info('Scaffold cancelled');
        return;
      }

      const document = documents.find((d) => d.name === name.value);
      if (document === undefined) {
        logger.error(`Invalid document: "${name.value}"`);
        return;
      }
      logger.debug(`name: "${name.value}"`);

      try {
        const files = await api!.generate(document, uri.fsPath, {
          inputs: async (context) => {
            const inputs = await buildInputs(context, document);
            logger.debug('inputs:', inputs);
            return inputs;
          },
        });

        logger.debug('files:', files);

        const writes = new Set<scaffdog.File>();
        const skips = new Set<scaffdog.File>();

        for (const file of files) {
          if (file.skip) {
            skips.add(file);
            continue;
          }

          const target = vscode.Uri.file(file.path);

          // Check overwrite the file
          if (!config.force && (await isFileExists(target))) {
            const result = await vscode.window.showWarningMessage(
              'The file to be generated already exists!',
              {
                modal: true,
                detail: `The "${target.path}" you tried to generate already exists. Select 'Overwrite' to execute an overwrite of the file.`,
              },
              'Overwrite',
            );

            // cancel
            if (result === undefined) {
              skips.add({
                ...file,
                skip: true,
              });
              continue;
            }
          }

          await vscode.workspace.fs.writeFile(
            target,
            Buffer.from(file.content, 'utf8'),
          );

          writes.add(file);
        }

        // logging
        const msg = {
          write: `${writes.size} ${plur('file', writes.size)}`,
          skip: skips.size > 0 ? ` (${skips.size} skipped)` : '',
        };

        logger.info(`Generated ${msg.write}!${msg.skip}`);

        for (const file of [...writes, ...skips]) {
          const suffix = file.skip ? ' (skipped)' : '';
          logger.info(`- "${file.path}"${suffix}`);
        }
      } catch (e) {
        if (e instanceof InputsCancelError) {
          logger.info('Scaffold cancelled');
        } else {
          logger.error('Generate error', e);
        }
      }
    },

    dispose: () => {
      mod.clear();
      cache.clear();
      root = null;
      pkg = null;
      api = null;
    },
  };
};
