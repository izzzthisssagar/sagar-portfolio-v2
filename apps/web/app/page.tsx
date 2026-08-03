import {
  AboutSection,
  ContactFooter,
  EvidenceSection,
  FieldNotesSection,
  Hero,
  MethodSection,
  ProjectIndex,
  QAMasterySection,
  QARiftTeaser,
} from '@/components/HomeSections';
import { getPublishedProjectBySlug, getPublishedProjects } from '@/lib/public-content.server';

export default async function Home() {
  const [projects, qaMastery] = await Promise.all([
    getPublishedProjects(),
    getPublishedProjectBySlug('qa-mastery'),
  ]);
  return (
    <main id="main">
      <Hero />
      <EvidenceSection />
      <QAMasterySection project={qaMastery} />
      <ProjectIndex projects={projects} />
      <MethodSection />
      <FieldNotesSection />
      <AboutSection />
      <QARiftTeaser />
      <ContactFooter />
    </main>
  );
}
