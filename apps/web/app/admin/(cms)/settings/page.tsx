import { CvSettings } from '@/components/CvSettings';
import { PortraitSettings } from '@/components/PortraitSettings';
import { adminServer } from '@/lib/admin-api.server';

export default async function Settings() {
  const [profile, cvDocuments] = await Promise.all([
    adminServer.getProfile(),
    adminServer.listCv(),
  ]);

  return (
    <main id="main">
      <p className="eyebrow">Admin / Settings</p>
      <h1>Profile, CV, SEO, and site settings</h1>
      <p>Secrets are environment-managed and never editable as public content.</p>
      <PortraitSettings profile={profile} />
      <CvSettings documents={cvDocuments ?? []} />
    </main>
  );
}
