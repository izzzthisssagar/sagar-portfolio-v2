import { AboutSection } from '@/components/HomeSections';
import { getActivePortrait } from '@/lib/public-content.server';
export default async function About() {
  const portrait = await getActivePortrait();
  return (
    <main id="main">
      <AboutSection portrait={portrait} />
    </main>
  );
}
