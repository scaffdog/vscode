import * as vscode from 'vscode';
import { getConfig } from './config';
import { createLogger } from './lib/logger';
import { createModuleLibrary } from './lib/module';
import { createPromptLibrary } from './lib/prompt';
import { createScaffdogLibrary } from './lib/scaffdog';

export const activate = async (context: vscode.ExtensionContext) => {
  vscode.commands.executeCommand('setContext', 'scaffdog.enabled', false);

  const { enable, debug } = getConfig();
  if (!enable) {
    return;
  }

  const logger = createLogger();

  if (debug) {
    logger.setLevel('DEBUG');
  }

  logger.info(`Extension version: ${process.env.EXTENSION_VERSION ?? '0.0.0'}`);

  const root = vscode.workspace.workspaceFolders?.[0]?.uri ?? null;
  logger.debug(`Workspace folder: "${root?.fsPath ?? null}"`);

  if (root === null) {
    logger.warn(
      'The scaffdog extension was not activated because the workspace folder could not be found, please open the folder to activate the scaffdog extension.',
    );
    return;
  }

  // initialize
  vscode.commands.executeCommand('setContext', 'scaffdog.enabled', true);

  const mod = createModuleLibrary(logger);
  const prompt = createPromptLibrary(logger);
  const scaffdog = createScaffdogLibrary(logger, mod, prompt);

  const disposables = [
    vscode.commands.registerCommand('scaffdog.openOutput', () => {
      logger.show();
    }),
    vscode.commands.registerCommand(
      'scaffdog.runInSelectedFolder',
      scaffdog.runInSelectedFolder,
    ),
    ...scaffdog.register(root),
  ];

  context.subscriptions.push(...disposables);
};
