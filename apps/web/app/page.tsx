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
import {
  getPublishedPosts,
  getPublishedProjectBySlug,
  getPublishedProjects,
} from '@/lib/public-content.server';

export default async function Home() {
  const [projects, qaMastery, notes] = await Promise.all([
    getPublishedProjects(),
    getPublishedProjectBySlug('qa-mastery'),
    getPublishedPosts(),
  ]);
  return (
    <main id="main">
      <Hero />
      <EvidenceSection />
      <QAMasterySection project={qaMastery} />
      <ProjectIndex projects={projects} />
      <MethodSection />
      <FieldNotesSection notes={notes} />
      <AboutSection />
      <QARiftTeaser />
      <ContactFooter />
    </main>
  );
}
