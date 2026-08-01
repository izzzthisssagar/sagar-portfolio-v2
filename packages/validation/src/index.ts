import { z } from 'zod';

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
export const projectInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  slug: slugSchema,
  summary: z.string().trim().min(20).max(500),
  status: z.enum(['draft', 'review', 'published', 'archived']),
  order: z.number().int().min(0).max(10_000),
});

const extensions = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'svg',
  'pdf',
  'mp4',
  'webm',
  'glb',
  'gltf',
]);
const dangerous = new Set([
  'php',
  'sh',
  'bash',
  'zsh',
  'html',
  'htm',
  'js',
  'mjs',
  'cjs',
  'exe',
  'dll',
]);
export function validateMediaFilename(filename: string): boolean {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..'))
    return false;
  const parts = filename.toLowerCase().split('.');
  if (parts.length !== 2) return false;
  const extension = parts[1];
  return Boolean(extension && extensions.has(extension) && !dangerous.has(extension));
}
