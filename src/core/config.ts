import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { MemoryError } from './contracts.js';

const positive = z.number().int().positive();
export const UserConfigSchema = z
  .object({
    promotion: z
      .object({
        enabled: z.boolean().default(true),
        min_computations: positive.default(2),
        stable_boundaries: z
          .array(
            z
              .object({
                repository: z.string(),
                ref: z.string().optional(),
                oid: z
                  .string()
                  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
                  .optional(),
              })
              .strict()
              .refine((v) => !!v.ref !== !!v.oid, 'specify ref or oid'),
          )
          .default([]),
      })
      .default({ enabled: true, min_computations: 2, stable_boundaries: [] }),
    segments: z
      .object({ max_commits: positive.default(256), max_bytes: positive.default(16777216) })
      .default({ max_commits: 256, max_bytes: 16777216 }),
    cache: z.object({ max_bytes: positive.default(1073741824) }).default({ max_bytes: 1073741824 }),
    profiles: z
      .object({ max_entries: positive.default(4096), retention_days: positive.default(30) })
      .default({ max_entries: 4096, retention_days: 30 }),
    background: z
      .object({
        enabled: z.boolean().default(true),
        timeout_ms: positive.default(30000),
        grace_ms: positive.default(5000),
        max_attempts: positive.default(3),
        max_staging_bytes: positive.default(536870912),
      })
      .default({
        enabled: true,
        timeout_ms: 30000,
        grace_ms: 5000,
        max_attempts: 3,
        max_staging_bytes: 536870912,
      }),
  })
  .strict();
export const RepoConfigSchema = z
  .object({
    background: z.object({ enabled: z.boolean().default(true) }).optional(),
    extensions: z
      .array(
        z.union([
          z
            .object({ path: z.string(), inputs: z.record(z.string(), z.unknown()).optional() })
            .strict(),
          z
            .object({
              id: z.string(),
              version: z.string(),
              inputs: z.record(z.string(), z.unknown()).optional(),
            })
            .strict(),
        ]),
      )
      .default([]),
  })
  .strict();
export type UserConfig = z.infer<typeof UserConfigSchema>;
export type RepoConfig = z.infer<typeof RepoConfigSchema>;
export function readYaml(path: string): unknown {
  if (!existsSync(path)) return {};
  try {
    return parse(readFileSync(path, 'utf8')) ?? {};
  } catch (error) {
    throw new MemoryError('configuration', `Cannot parse ${path}: ${String(error)}`);
  }
}
export function configuration(
  repo: string,
  home = process.env.ZMEM_HOME ?? join(homedir(), '.zmem'),
) {
  try {
    return {
      home: resolve(home),
      user: UserConfigSchema.parse(readYaml(join(home, 'config.yaml'))),
      repo: RepoConfigSchema.parse(readYaml(join(repo, '.zmem', 'config.yaml'))),
    };
  } catch (error) {
    if (error instanceof MemoryError) throw error;
    throw new MemoryError('configuration', String(error));
  }
}
