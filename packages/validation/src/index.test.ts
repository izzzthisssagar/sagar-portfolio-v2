import { describe, expect, it } from 'vitest';
import { projectInputSchema, validateMediaFilename } from './index';

describe('media filename policy', () => {
  it.each(['shell.php', 'photo.jpg.php', '../secret.png', 'x.html', 'x.js', 'x.unknown'])(
    'rejects %s',
    (name) => expect(validateMediaFilename(name)).toBe(false),
  );
  it.each(['portrait.png', 'model.glb', 'evidence.pdf', 'clip.webm'])('allows %s', (name) =>
    expect(validateMediaFilename(name)).toBe(true),
  );
});

it('rejects project input that cannot be safely published', () => {
  expect(
    projectInputSchema.safeParse({
      title: 'x',
      slug: 'Bad Slug',
      summary: 'short',
      status: 'published',
      order: -1,
    }).success,
  ).toBe(false);
});
