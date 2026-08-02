import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/SiteHeader';
import { ExperiencePreferencesProvider } from '@/components/ExperiencePreferences';
export const metadata: Metadata = {
  title: { default: 'Sagar Thapa / Quality Engineer', template: '%s / Sagar Thapa' },
  description:
    'QA portfolio investigating interfaces, business rules, APIs, security, accessibility, and performance.',
  openGraph: {
    title: 'Sagar Thapa / Quality Engineer',
    description: 'I turn assumptions into evidence.',
    type: 'website',
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
