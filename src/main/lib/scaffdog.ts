import * as fs from 'node:fs';
import plur from 'plur';
import type * as scaffdog from 'scaffdog';
import * as semver from 'semver';
import * as vscode from 'vscode';
import { MIN_SCAFFDOG_VERSION } from '../../shared/constants';
import { ScaffdogAdapter } from '../adapter';
import { getConfig } from '../config';
import { Logger } from './logger';
import { ModuleLibrary } from './module';
import { PromptLibrary } from './prompt';
import { PromptCancelError } from '../../shared/errors';

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

export type ScaffdogLibrary = vscode.Disposable & {
  register: (root: vscode.Uri) => Promise<vscode.Disposable[]>;
  runInSelectedFolder: (uri: vscode.Uri | undefined) => Promise<void>;
};

export const createScaffdogLibrary = (
  logger: Logger,
  mod: ModuleLibrary,
  prompt: PromptLibrary,
  adapter: ScaffdogAdapter,
): ScaffdogLibrary => {
  let root: vscode.Uri | null = null;
  let config = getConfig();
  let specifier: string | null = null;

  const initialize = async (dir: vscode.Uri) => {
    specifier = mod.findPackage(dir.fsPath, 'scaffdog');
    logger.debug(`Found module path: "${specifier}"`);

    root = dir;
    config = getConfig(root);

    const info = await adapter.import(specifier);
    logger.info(`Found module version: "${info.version}"`);
    if (
      info.type === 'local' &&
      semver.gte(info.version, MIN_SCAFFDOG_VERSION)
    ) {
      logger.info(`Use local scaffdog module (version: "${info.version}")`);
    } else {
      logger.info(`Use bundle scaffdog module (version: "${info.version}")`);
      vscode.window.showWarningMessage(
        `scaffdog requires a minimum "v${MIN_SCAFFDOG_VERSION}" version. Modules bundled in extensions were used instead of local modules.`,
      );
    }
  };

  const reset = async () => {
    mod.clear();
    await initialize(vscode.workspace.workspaceFolders![0].uri);
    logger.info('scaffdog reset!');
  };

  return {
    register: async (dir) => {
      const cfg = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('scaffdog.enable')) {
          logger.warn(
            'To enable or disable scaffdog after changing the `enable` setting, you must re-start VS Code.',
          );
        } else if (e.affectsConfiguration('scaffdog')) {
          reset().catch(logger.error);
        }
      });

      root = dir;
      await initialize(root);

      return [cfg];
    },

    runInSelectedFolder: async (selectedUri) => {
      if (root === null) {
        return;
      }

      const { project } = getConfig(root ?? undefined);

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

      // Select documents
      let documents: scaffdog.Document[];
      try {
        documents = await adapter.list({
          specifier,
          project,
          root: root.fsPath,
        });
      } catch (e) {
        logger.error('Document loading error', e);
        vscode.window.showErrorMessage(`${e}`);
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

      // Generate
      try {
        const files = await adapter.generate({
          specifier,
          project,
          root: root.fsPath,
          document,
          output: uri.fsPath,
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
        if (e instanceof PromptCancelError) {
          logger.info('Scaffold cancelled');
        } else {
          logger.error('Generate error', e);
          vscode.window.showErrorMessage(
            `An error occurred in scaffdog generate (${e})`,
          );
        }
      }
    },

    dispose: () => {
      adapter.dispose();
      mod.clear();
    },
  };
};
