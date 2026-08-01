import { Injectable, NotFoundException } from '@nestjs/common';
export interface ProjectEntity {
  id: string;
  title: string;
  slug: string;
  summary: string;
  status: 'draft' | 'review' | 'published' | 'archived';
  order: number;
}
@Injectable()
export class ProjectsService {
  private readonly records = new Map<string, ProjectEntity>([
    [
      'qa-mastery',
      {
        id: 'qa-mastery',
        title: 'QA Mastery',
        slug: 'qa-mastery',
        summary: 'Independently conceived QA learning platform under active development.',
        status: 'published',
        order: 1,
      },
    ],
  ]);
  list() {
    return [...this.records.values()].sort((a, b) => a.order - b.order);
  }
  get(id: string) {
    const record = this.records.get(id);
    if (!record) throw new NotFoundException('Project not found');
    return record;
  }
  create(input: Omit<ProjectEntity, 'id'>) {
    const record = { ...input, id: input.slug };
    this.records.set(record.id, record);
    return record;
  }
  update(id: string, input: Partial<Omit<ProjectEntity, 'id'>>) {
    const record = { ...this.get(id), ...input, id };
    this.records.set(id, record);
    return record;
  }
  remove(id: string) {
    this.get(id);
    this.records.delete(id);
  }
}
