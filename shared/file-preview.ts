import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const FILE_PREVIEW_MAX_BYTES = 32 * 1024;
export const FILE_PREVIEW_MAX_LINES = 200;

export const filePreviewInput = z.object({
  agentId: z.string().min(1),
  href: z.string().min(1).max(8192),
});

export const filePreviewOutput = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    path: z.string(),
    content: z.string().max(FILE_PREVIEW_MAX_BYTES),
    startLine: z.number().int().positive(),
    totalLines: z.number().int().positive(),
    lineStart: z.number().int().positive().nullable(),
    lineEnd: z.number().int().positive().nullable(),
    truncated: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    message: z.string().max(512),
  }),
]);

export const previewFile = defineRpc({
  name: "advanced-markdown.file.preview",
  input: filePreviewInput,
  output: filePreviewOutput,
});

export type FilePreviewInput = z.infer<typeof filePreviewInput>;
export type FilePreviewOutput = z.infer<typeof filePreviewOutput>;
