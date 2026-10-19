import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  AuthResponse,
  LoginCodeSent,
  LoginInput,
  RegisterInput,
  RequestLoginCodeInput,
  VerifyLoginCodeInput,
} from '@intellmeet/shared';
import { peekPendingInvite } from '@/features/teams/pendingInvite';
import { useAuthStore } from '@/stores/authStore';
import { useSocketStore } from '@/stores/socketStore';
import * as authApi from './auth.api';
import { postAuthPath } from './postAuthPath';
import { peekReturnPath } from './returnPath';

function useOnSignedIn(): (result: AuthResponse) => void {
  const setSession = useAuthStore((state) => state.setSession);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  return (result) => {
    setSession(result.user, result.accessToken);
    // Nothing cached belongs to the account that just signed in.
    queryClient.clear();

    // Peeked, not consumed: PublicOnlyRoute reaches the same decision in the
    // same commit, and clearing the code here would leave it with nothing to
    // read. The join page clears it once it has actually tried to redeem it.
    navigate(postAuthPath(location.state, peekPendingInvite(), peekReturnPath()), {
      replace: true,
    });
  };
}

export function useLogin(): UseMutationResult<AuthResponse, Error, LoginInput> {
  const onSignedIn = useOnSignedIn();
  return useMutation({ mutationFn: authApi.login, onSuccess: onSignedIn });
}

export function useRegister(): UseMutationResult<AuthResponse, Error, RegisterInput> {
  const onSignedIn = useOnSignedIn();
  return useMutation({ mutationFn: authApi.register, onSuccess: onSignedIn });
}

/** Emails a code. Signs nobody in: that is `useVerifyLoginCode`. */
export function useRequestLoginCode(): UseMutationResult<
  LoginCodeSent,
  Error,
  RequestLoginCodeInput
> {
  return useMutation({ mutationFn: authApi.requestLoginCode });
}

/** Spends the emailed code: signs in, or creates the account and signs in. */
export function useVerifyLoginCode(): UseMutationResult<AuthResponse, Error, VerifyLoginCodeInput> {
  const onSignedIn = useOnSignedIn();
  return useMutation({ mutationFn: authApi.verifyLoginCode, onSuccess: onSignedIn });
}

export function useDemoLogin(): UseMutationResult<AuthResponse, Error, void> {
  const onSignedIn = useOnSignedIn();
  return useMutation({ mutationFn: () => authApi.demoLogin(), onSuccess: onSignedIn });
}

/** Everything a signed-in tab holds, dropped, and the visitor sent home. */
function useOnSignedOut(): () => void {
  const clearSession = useAuthStore((state) => state.clearSession);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return () => {
    // Marked as a sign-out, so ProtectedRoute sends the page that re-renders
    // first home too, rather than to /login remembering where they were.
    clearSession({ signedOut: true });
    // Through the store rather than the socket module: this hook is imported
    // by the sign-in pages, and reaching for the library here would drag
    // socket.io-client back into the public bundle.
    useSocketStore.getState().teardown();
    queryClient.clear();
    navigate('/', { replace: true });
  };
}

export function useLogout(): UseMutationResult<void, Error, void> {
  const onSignedOut = useOnSignedOut();

  return useMutation({
    mutationFn: () => authApi.logout(),
    // `onSettled`, not `onSuccess`: if the network call fails the user still
    // asked to sign out, and leaving them in a half-signed-in state would be
    // worse than a refresh token that outlives the tab by a few minutes.
    onSettled: onSignedOut,
  });
}

/**
 * Deletes the signed-in guest and signs out.
 *
 * `onSuccess`, unlike logout: if the delete failed the guest and its meetings
 * still exist, and pretending otherwise would hide that from the person who
 * asked for them to be gone. The error is shown instead.
 */
export function useEndDemoSession(): UseMutationResult<void, Error, void> {
  const onSignedOut = useOnSignedOut();
  return useMutation({ mutationFn: () => authApi.endDemoSession(), onSuccess: onSignedOut });
}
