import * as vscode from 'vscode';
import { Logger } from './logger';

const defaultValidate = (_: unknown) => null;

export type PromptValidator = (value: string) => string | null;
export type PromptMultiValidator = (values: string[]) => string | null;

export type PromptResult<T> =
  | {
      state: 'success';
      value: T;
    }
  | {
      state: 'failure';
      reason: 'cancel';
    };

export type PromptItem =
  | string
  | {
      value: string;
      description: string;
    };

export type PromptOptions = {
  title: string;
  step?: number;
  total?: number;
};

export type PromptInputOptions = PromptOptions & {
  validate?: PromptValidator;
};

export type PromptConfirmOptions = PromptOptions;

export type PromptListOptions = PromptOptions & {
  items: PromptItem[];
  validate?: PromptValidator;
};

export type PromptSelectOptions = PromptOptions & {
  items: PromptItem[];
  validate?: PromptMultiValidator;
};

export type PromptLibrary = {
  input: (options: PromptInputOptions) => Promise<PromptResult<string>>;
  confirm: (options: PromptConfirmOptions) => Promise<PromptResult<boolean>>;
  list: (options: PromptListOptions) => Promise<PromptResult<string>>;
  select: (options: PromptSelectOptions) => Promise<PromptResult<string[]>>;
};

export const createPromptLibrary = (logger: Logger): PromptLibrary => {
  const showQuickPick = <T>(
    props: PromptOptions & {
      multiple: boolean;
      items: vscode.QuickPickItem[];
    },
    onAccept: (
      e: readonly vscode.QuickPickItem[],
      done: (value: T) => void,
    ) => any,
  ): Promise<PromptResult<T>> =>
    new Promise((resolve) => {
      let latest: readonly vscode.QuickPickItem[];

      const qp = vscode.window.createQuickPick();
      qp.title = props.title;
      qp.step = props.step;
      qp.totalSteps = props.total;
      qp.items = props.items;
      qp.canSelectMany = props.multiple;
      qp.onDidAccept(() => {
        onAccept(latest, (value) => {
          resolve({
            state: 'success',
            value,
          });
          qp.hide();
        });
      });
      qp.onDidChangeSelection((selection) => {
        latest = selection;
      });
      qp.onDidHide(() => {
        qp.dispose();
        resolve({
          state: 'failure',
          reason: 'cancel',
        });
      });
      qp.show();
    });

  return {
    input: ({ title, step, total, validate = defaultValidate }) =>
      new Promise((resolve) => {
        const input = vscode.window.createInputBox();
        input.title = title;
        input.step = step;
        input.totalSteps = total;
        input.onDidAccept(() => {
          const value = input.value.trim();
          const message = validate(value);
          logger.debug('prompt.input#onDidAccept', {
            value,
            message,
          });
          if (message === null) {
            resolve({
              state: 'success',
              value,
            });
            input.hide();
          } else {
            input.validationMessage = message;
          }
        });
        input.onDidHide(() => {
          input.dispose();
          resolve({
            state: 'failure',
            reason: 'cancel',
          });
        });
        input.show();
      }),

    confirm: ({ title, step, total }) => {
      const items = [
        {
          label: 'Yes',
        },
        {
          label: 'No',
        },
      ];

      return showQuickPick(
        {
          title,
          step,
          total,
          items,
          multiple: false,
        },
        (selection, done) => {
          const label: string | null = selection[0]?.label ?? null;
          if (label === null) {
            throw new Error('Invalid confirm value');
          }
          const found = items.find((item) => item.label === label);
          if (found === undefined) {
            throw new Error('Invalid confirm value');
          }
          done(found.label === 'Yes');
        },
      );
    },

    list: ({ title, items, step, total, validate = defaultValidate }) => {
      return showQuickPick(
        {
          title,
          step,
          total,
          items: items.map((item) =>
            typeof item === 'string'
              ? { label: item }
              : {
                  label: item.value,
                  description: item.description,
                },
          ),
          multiple: false,
        },
        (selection, done) => {
          const value: string | null = selection[0]?.label ?? null;
          const message = validate(value);
          logger.debug('prompt.list#onDidAccept', {
            value,
            message,
          });
          if (message === null) {
            done(value);
          }
        },
      );
    },

    select: ({ title, items, step, total, validate = defaultValidate }) => {
      return showQuickPick(
        {
          title,
          step,
          total,
          items: items.map((item) =>
            typeof item === 'string'
              ? { label: item }
              : {
                  label: item.value,
                  description: item.description,
                },
          ),
          multiple: true,
        },
        (selection, done) => {
          const values = selection.map((s) => s.label);
          const message = validate(values);
          logger.debug('prompt.select#onDidAccept', {
            values,
            message,
          });
          if (message === null) {
            done(values);
          }
        },
      );
    },
  };
};
