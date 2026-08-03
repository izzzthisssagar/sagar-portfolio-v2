import type { Metadata } from 'next';
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
  getPublicProfile,
  getPublishedPosts,
  getPublishedProjectBySlug,
  getPublishedProjects,
} from '@/lib/public-content.server';
import { JsonLd, personJsonLd, websiteJsonLd } from '@/lib/seo';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default async function Home() {
  const [projects, qaMastery, notes, portrait, cvAvailable, profile] = await Promise.all([
    getPublishedProjects(),
    getPublishedProjectBySlug('qa-mastery'),
    getPublishedPosts(),
    getActivePortrait(),
    getCvAvailable(),
    getPublicProfile(),
  ]);
  return (
    <main id="main">
      {profile && (
        <>
          <JsonLd data={personJsonLd(profile)} />
          <JsonLd data={websiteJsonLd()} />
        </>
      )}
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
