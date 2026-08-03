import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/SiteHeader';
import { ExperiencePreferencesProvider } from '@/components/ExperiencePreferences';
import { getSiteUrl } from '@/lib/seo';

const TITLE = 'Sagar Thapa / Quality Engineer';
const DESCRIPTION =
  'QA portfolio investigating interfaces, business rules, APIs, security, accessibility, and performance.';

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: { default: TITLE, template: '%s / Sagar Thapa' },
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: 'I turn assumptions into evidence.',
    type: 'website',
    siteName: TITLE,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: 'I turn assumptions into evidence.',
  },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <ExperiencePreferencesProvider>
          <SiteHeader />
          {children}
        </ExperiencePreferencesProvider>
      </body>
    </html>
  );
}
