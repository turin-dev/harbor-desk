export type AuthGateView = "checking" | "login" | "shell";

export function resolveAuthGateView({
  hasUser,
  isPending,
  hasCompletedRequest,
  errorCode,
}: {
  hasUser: boolean;
  isPending: boolean;
  hasCompletedRequest: boolean;
  errorCode: string | undefined;
}): AuthGateView {
  if (isPending && !hasCompletedRequest) return "checking";
  if (!hasUser && errorCode === "unauthorized") return "login";
  return "shell";
}

export function shouldShowInitialGatewayLoading({
  isLoading,
  hasCompletedRequest,
}: {
  isLoading: boolean;
  hasCompletedRequest: boolean;
}): boolean {
  return isLoading && !hasCompletedRequest;
}
