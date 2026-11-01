/** What went wrong at the last sign-in (the codes the API's callback sends back), in words. */
export const LOGIN_ERRORS: Partial<Record<string, string>> = {
  denied: "Sign-in was cancelled or refused by the identity provider.",
  "no-role": "Your account has no role in ShipScope Flags. Ask an Admin to grant you access.",
  expired: "The sign-in took too long. Try again.",
  failed: "Sign-in failed. Try again; if it keeps failing, ask an Admin to check the API log.",
  unavailable: "The identity provider is not reachable. Try again in a moment.",
  "session-ended": "Your session has ended. Sign in again.",
};

/** A sign-in error code from the address; anything else (someone else's text in a crafted link) is shown as "failed". */
export const loginErrorCode = (code: string | null | undefined) => (code ? (Object.hasOwn(LOGIN_ERRORS, code) ? code : "failed") : undefined);
