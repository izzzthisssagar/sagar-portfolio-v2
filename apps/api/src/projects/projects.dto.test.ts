import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateProjectDto } from './projects.dto';

describe('UpdateProjectDto', () => {
  it('validates supplied fields while allowing a partial update', async () => {
    expect(
      await validate(plainToInstance(UpdateProjectDto, { title: 'Updated title' })),
    ).toHaveLength(0);
    expect(
      await validate(plainToInstance(UpdateProjectDto, { slug: 'Invalid Slug', order: -1 })),
    ).not.toHaveLength(0);
  });
});
