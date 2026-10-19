import { Link } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { EmailCodeForm } from './EmailCodeForm';

/**
 * Sign-up is a name and an email address, then the code sent to it: no
 * password to invent, and an address that has been proven to be theirs from the
 * first minute. The account is created when the code is entered, not before.
 */
export function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Start running meetings that write themselves up."
      footer={
        <>
          Already have an account?&nbsp;
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <EmailCodeForm purpose="register" />
    </AuthShell>
  );
}
