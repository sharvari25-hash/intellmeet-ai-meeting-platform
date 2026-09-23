import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AuthResponse, LoginInput, RegisterInput } from '@intellmeet/shared';
import { useAuthStore } from '@/stores/authStore';
import { useSocketStore } from '@/stores/socketStore';
import * as authApi from './auth.api';

/** Where to land after signing in, honouring the page the user was aiming for. */
function useRedirectTarget(): string {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  // Only same-origin paths from our own router state are honoured; anything
  // else would be an open redirect.
  return from?.startsWith('/') ? from : '/app';
}

function useOnSignedIn(): (result: AuthResponse) => void {
  const setSession = useAuthStore((state) => state.setSession);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const target = useRedirectTarget();

  return (result) => {
    setSession(result.user, result.accessToken);
    // Nothing cached belongs to the account that just signed in.
    queryClient.clear();
    navigate(target, { replace: true });
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

export function useDemoLogin(): UseMutationResult<AuthResponse, Error, void> {
  const onSignedIn = useOnSignedIn();
  return useMutation({ mutationFn: () => authApi.demoLogin(), onSuccess: onSignedIn });
}

export function useLogout(): UseMutationResult<void, Error, void> {
  const clearSession = useAuthStore((state) => state.clearSession);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () => authApi.logout(),
    // `onSettled`, not `onSuccess`: if the network call fails the user still
    // asked to sign out, and leaving them in a half-signed-in state would be
    // worse than a refresh token that outlives the tab by a few minutes.
    onSettled: () => {
      clearSession();
      // Through the store rather than the socket module: this hook is imported
      // by the sign-in pages, and reaching for the library here would drag
      // socket.io-client back into the public bundle.
      useSocketStore.getState().teardown();
      queryClient.clear();
      navigate('/', { replace: true });
    },
  });
}
