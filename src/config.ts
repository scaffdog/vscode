import * as vscode from 'vscode';

export type ScaffdogVsCodeConfig = {
  enable: boolean;
  debug: boolean;
  project: string;
  force: boolean;
};

export const getConfig = (scope?: vscode.Uri): ScaffdogVsCodeConfig => {
  return vscode.workspace.getConfiguration(
    'scaffdog',
    scope,
  ) as unknown as ScaffdogVsCodeConfig;
};
