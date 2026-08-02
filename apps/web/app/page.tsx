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
export default function Home() {
  return (
    <main id="main">
      <Hero />
      <EvidenceSection />
      <QAMasterySection />
      <ProjectIndex />
      <MethodSection />
      <FieldNotesSection />
      <AboutSection />
      <QARiftTeaser />
      <ContactFooter />
    </main>
  );
}
