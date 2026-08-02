'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, auth } from '@/lib/admin-api.client';
import { safeReturnTo } from '@/lib/safe-redirect';

type Status = 'idle' | 'loading' | 'invalid' | 'locked' | 'error';

const STATUS_MESSAGE: Record<Exclude<Status, 'idle' | 'loading'>, string> = {
  invalid: 'Incorrect email or password.',
  locked: 'Too many attempts. Try again in a few minutes.',
  error: 'Something went wrong. Try again.',
};

export function LoginForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('loading');
    try {
      await auth.login(email, password);
      router.push(safeReturnTo(returnTo));
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'ACCOUNT_LOCKED') setStatus('locked');
        else if (error.status === 401) setStatus('invalid');
        else setStatus('error');
      } else {
        setStatus('error');
      }
    }
  }

  const isLoading = status === 'loading';
  const feedback = status === 'idle' || status === 'loading' ? null : STATUS_MESSAGE[status];

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={status === 'invalid' || undefined}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={12}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={status === 'invalid' || undefined}
        />
      </div>
      <p role="status" aria-live="polite" className={feedback ? `login-feedback login-feedback--${status}` : 'login-feedback'}>
        {feedback}
      </p>
      <button className="button primary" type="submit" aria-busy={isLoading} disabled={isLoading}>
        {isLoading ? 'SIGNING IN…' : 'SIGN IN'}
      </button>
    </form>
  );
}
