import {
  login as loginRequest,
  logout as logoutRequest,
  oauthProviders as oauthProvidersRequest,
  oauthStartUrl,
  forgotPassword as forgotPasswordRequest,
  register as registerRequest,
  requestEmailVerification as requestEmailVerificationRequest,
  resetPassword as resetPasswordRequest,
  verifyEmail as verifyEmailRequest,
  verifyMfaLogin as verifyMfaLoginRequest,
  verifyOAuthMfaLogin as verifyOAuthMfaLoginRequest,
  type LoginInput,
  type RegisterInput,
} from "./api";

export function useAuthOperations() {
  return {
    login: (input: LoginInput) => loginRequest(input),
    verifyMfaLogin: (challengeToken: string, code: string) => verifyMfaLoginRequest(challengeToken, code),
    verifyOAuthMfaLogin: (code: string) => verifyOAuthMfaLoginRequest(code),
    oauthProviders: () => oauthProvidersRequest(),
    oauthStartUrl,
    register: (input: RegisterInput) => registerRequest(input),
    logout: () => logoutRequest(),
    requestEmailVerification: (email: string) => requestEmailVerificationRequest(email),
    verifyEmail: (token: string) => verifyEmailRequest(token),
    forgotPassword: (email: string) => forgotPasswordRequest(email),
    resetPassword: (token: string, password: string) => resetPasswordRequest(token, password),
  };
}
