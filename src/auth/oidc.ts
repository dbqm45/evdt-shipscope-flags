import { Injectable, Logger } from "@nestjs/common";
import * as client from "openid-client";
import { authConfig, userFromClaims, type AuthConfig, type SignedInUser } from "./auth-config.js";

/** What the browser keeps (in a short-lived cookie) between the redirect to the provider and the callback. */
export interface LoginChecks {
  state: string;
  nonce: string;
  verifier: string;
}

/** The OpenID Connect side of sign-in. The provider's metadata is fetched on first use, so the API starts without it. */
@Injectable()
export class OidcClient {
  readonly config: AuthConfig = authConfig();
  readonly redirectUri = `${this.config.appUrl.href.replace(/\/$/, "")}/api/auth/callback`;
  private readonly logger = new Logger(OidcClient.name);
  private provider?: Promise<client.Configuration>;

  private discover(): Promise<client.Configuration> {
    const { issuer, discoveryUrl, clientId, clientSecret, allowHttp } = this.config;
    this.provider ??= client
      .discovery(discoveryUrl ?? new URL(issuer), clientId, clientSecret, undefined, allowHttp ? { execute: [client.allowInsecureRequests] } : undefined)
      .then((provider) => {
        // Fetched from OIDC_DISCOVERY_URL, the metadata is not checked against the issuer by the library: do it here.
        if (provider.serverMetadata().issuer !== issuer)
          throw new Error(`The provider's metadata names issuer "${provider.serverMetadata().issuer}", not OIDC_ISSUER "${issuer}".`);
        return provider;
      })
      .catch((err: unknown) => {
        this.provider = undefined; // try again on the next sign-in
        this.logger.error(`Cannot read the OIDC provider's metadata: ${(err as Error).message}`);
        throw err;
      });
    return this.provider;
  }

  /** Where to send the browser to sign in, and the checks to keep for the callback. */
  async startLogin(): Promise<{ url: URL; checks: LoginChecks }> {
    const provider = await this.discover();
    const checks = { state: client.randomState(), nonce: client.randomNonce(), verifier: client.randomPKCECodeVerifier() };
    const url = client.buildAuthorizationUrl(provider, {
      redirect_uri: this.redirectUri,
      scope: this.config.scopes,
      state: checks.state,
      nonce: checks.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(checks.verifier),
      code_challenge_method: "S256",
    });
    return { url, checks };
  }

  /**
   * Completes sign-in from the callback URL: exchanges the code and validates the ID token (signature, issuer,
   * audience, expiry, nonce). Returns null for a user the role settings do not let in; throws when anything fails.
   */
  async finishLogin(callbackUrl: URL, checks: LoginChecks): Promise<{ user: SignedInUser | null; idToken?: string }> {
    const provider = await this.discover();
    const tokens = await client.authorizationCodeGrant(provider, callbackUrl, {
      pkceCodeVerifier: checks.verifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims()!;
    return { user: userFromClaims(claims as Record<string, unknown>, this.config), idToken: tokens.id_token };
  }

  /** The provider's sign-out page (back to the dashboard afterwards), or the dashboard when the provider has none. */
  async logoutUrl(idToken?: string | null): Promise<string> {
    const home = this.config.appUrl.href;
    try {
      const provider = await this.discover();
      if (!provider.serverMetadata().end_session_endpoint) return home;
      const params: Record<string, string> = { post_logout_redirect_uri: home, client_id: this.config.clientId };
      if (idToken) params.id_token_hint = idToken;
      return client.buildEndSessionUrl(provider, params).href;
    } catch {
      return home;
    }
  }
}
