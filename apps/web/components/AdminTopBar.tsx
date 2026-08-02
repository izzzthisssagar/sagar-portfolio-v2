'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { auth } from '@/lib/admin-api.client';
import { ConfirmDialog } from './ConfirmDialog';

export function AdminTopBar({ email }: { email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'logout' | 'logout-all' | null>(null);
  const [confirmingLogoutAll, setConfirmingLogoutAll] = useState(false);

  async function handleLogout() {
    setBusy('logout');
    try {
      await auth.logout();
    } finally {
      router.push('/admin/login');
      router.refresh();
    }
  }

  async function handleLogoutAll() {
    setConfirmingLogoutAll(false);
    setBusy('logout-all');
    try {
      await auth.logoutAll();
    } finally {
      router.push('/admin/login');
      router.refresh();
    }
  }

  return (
    <div className="admin-topbar">
      <div>
        <span className="session-email">{email}</span>
        {' · '}
        <span className="session-status">Session active</span>
      </div>
      <div className="admin-topbar-actions">
        <button type="button" onClick={() => setConfirmingLogoutAll(true)} disabled={busy !== null}>
          {busy === 'logout-all' ? 'REVOKING…' : 'REVOKE ALL SESSIONS'}
        </button>
        <button type="button" onClick={handleLogout} disabled={busy !== null}>
          {busy === 'logout' ? 'SIGNING OUT…' : 'LOG OUT'}
        </button>
      </div>
      <ConfirmDialog
        open={confirmingLogoutAll}
        title="Revoke all sessions?"
        description="This immediately signs out every active administrator session, including this one."
        confirmLabel="REVOKE ALL"
        danger
        onConfirm={handleLogoutAll}
        onCancel={() => setConfirmingLogoutAll(false)}
      />
    </div>
  );
}
