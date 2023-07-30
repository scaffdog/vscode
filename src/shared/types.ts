import { z } from 'zod';
import type { WorkerMessage } from './connection';

const documentSchema = z
  .object({
    name: z.string(),
    questions: z.map(z.string(), z.any()),
  })
  .passthrough();

const fileSchema = z
  .object({
    skip: z.boolean(),
    path: z.string(),
    name: z.string(),
    content: z.string(),
  })
  .passthrough();

const questionSchema = z
  .object({
    type: z.union([
      z.literal('confirm'),
      z.literal('input'),
      z.literal('list'),
      z.literal('checkbox'),
    ]),
    choices: z.string().array().optional(),
  })
  .passthrough();

export const moduleSpecifierSchema = z.union([z.string(), z.null()]);
export type ModuleSpecifier = z.infer<typeof moduleSpecifierSchema>;

// import
export const scaffdogImportRequestSchema = z.object({
  specifier: moduleSpecifierSchema,
});
export const scaffdogImportResponseSchema = z.object({
  type: z.union([z.literal('local'), z.literal('bundle')]),
  version: z.string(),
});
export type ScaffdogImportMessage = WorkerMessage<
  'import',
  | z.infer<typeof scaffdogImportRequestSchema>
  | z.infer<typeof scaffdogImportResponseSchema>
>;

// list
export const scaffdogListRequestSchema = z.object({
  specifier: moduleSpecifierSchema,
  project: z.string(),
  root: z.string(),
});
export const scaffdogListResponseSchema = z.array(documentSchema);
export type ScaffdogListMessage = WorkerMessage<
  'list',
  | z.infer<typeof scaffdogListRequestSchema>
  | z.infer<typeof scaffdogListResponseSchema>
>;

// generate
export const scaffdogGenerateRequestSchema = z.object({
  kind: z.literal('main'),
  specifier: moduleSpecifierSchema,
  project: z.string(),
  root: z.string(),
  document: documentSchema,
  output: z.string(),
});
export const scaffdogGenerateResponseSchema = z.object({
  kind: z.literal('main'),
  files: z.array(fileSchema),
});
export const scaffdogGeneratePromptRequestSchema = z.object({
  kind: z.literal('prompt'),
  title: z.string(),
  step: z.number(),
  total: z.number(),
  question: questionSchema,
});
export const scaffdogGeneratePromptResponseSchema = z.union([
  z.object({
    kind: z.literal('prompt'),
    cancel: z.literal(true),
    value: z.null(),
  }),
  z.object({
    kind: z.literal('prompt'),
    cancel: z.literal(false),
    value: z.union([z.boolean(), z.string(), z.string().array()]),
  }),
]);
export type ScaffdogGenerateMessage = WorkerMessage<
  'generate',
  | z.infer<typeof scaffdogGenerateRequestSchema>
  | z.infer<typeof scaffdogGenerateResponseSchema>
  | z.infer<typeof scaffdogGeneratePromptRequestSchema>
  | z.infer<typeof scaffdogGeneratePromptResponseSchema>
>;

export type ScaffdogMessage =
  | ScaffdogImportMessage
  | ScaffdogListMessage
  | ScaffdogGenerateMessage;
