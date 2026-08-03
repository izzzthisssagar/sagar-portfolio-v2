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
  getActivePortrait,
  getCvAvailable,
  getPublishedPosts,
  getPublishedProjectBySlug,
  getPublishedProjects,
} from '@/lib/public-content.server';

export default async function Home() {
  const [projects, qaMastery, notes, portrait, cvAvailable] = await Promise.all([
    getPublishedProjects(),
    getPublishedProjectBySlug('qa-mastery'),
    getPublishedPosts(),
    getActivePortrait(),
    getCvAvailable(),
  ]);
  return (
    <main id="main">
      <Hero cvAvailable={cvAvailable} />
      <EvidenceSection />
      <QAMasterySection project={qaMastery} />
      <ProjectIndex projects={projects} />
      <MethodSection />
      <FieldNotesSection notes={notes} />
      <AboutSection portrait={portrait} />
      <QARiftTeaser />
      <ContactFooter />
    </main>
  );
}
