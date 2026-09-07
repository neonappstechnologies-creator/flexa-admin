import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main className="signin">
      <h1>Flexa · operator panel</h1>
      <p>
        Switch a clinic off, and control who its reminders reach. This is not a
        clinic&rsquo;s own account.
      </p>
      <LoginForm />
    </main>
  );
}
