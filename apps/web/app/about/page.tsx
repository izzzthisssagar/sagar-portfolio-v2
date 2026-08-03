import type { Metadata } from 'next';
import { AboutSection } from '@/components/HomeSections';
import { getNonce } from '@/lib/nonce.server';
import { getActivePortrait, getPublicProfile } from '@/lib/public-content.server';
import { JsonLd, personJsonLd, websiteJsonLd } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const profile = await getPublicProfile();
  return {
    title: 'About',
    description: profile?.bio ?? 'QA background, approach, and what I look for in a system.',
    alternates: { canonical: '/about' },
  };
}

export default async function About() {
  const [portrait, profile, nonce] = await Promise.all([
    getActivePortrait(),
    getPublicProfile(),
    getNonce(),
  ]);
  return (
    <main id="main">
      {profile && (
        <>
          <JsonLd data={personJsonLd(profile)} nonce={nonce} />
          <JsonLd data={websiteJsonLd()} nonce={nonce} />
        </>
      )}
      <AboutSection portrait={portrait} />
    </main>
  );
}
