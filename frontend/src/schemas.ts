import { z } from "zod";

export const translationSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string(),
  versification: z.string(),
  attribution: z.string().nullable(),
});

export const translationsResponseSchema = z.object({
  translations: z.array(translationSchema),
});

export const concordStatusSchema = z.object({
  base_url: z.string(),
  reachable: z.boolean(),
  status: z.string().nullable(),
  translation_count: z.number().nullable(),
  error: z.string().nullable(),
});

export const healthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
  concord: concordStatusSchema,
});

export type Translation = z.infer<typeof translationSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
