# PodToClips Authentication

PodToClips uses Clerk for identity and sessions while keeping the complete user
interface inside the PodToClips design system. The sign-in page, sign-up page,
verification steps, recovery flow, account menu, loading states, and errors are
all application-owned UI.

## Clerk application setup

1. Create a Clerk application.
2. Enable Google under SSO connections.
3. Enable email sign-up, email sign-in, passwords, and email verification codes.
4. Register `/sso-callback` for local and production OAuth redirects.
5. Set the application name, PodToClips logo, email sender, and email templates.
6. Configure the production custom domain so authentication URLs stay on the
   company domain.

The expected local callback is:

```text
http://localhost:3000/sso-callback
```

## Local environment

Frontend `.env.local`:

```text
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Backend `server/.env`:

```text
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_AUTHORIZED_PARTIES=http://localhost:3000
CLERK_AUTH_REQUIRED=0
```

Restart the frontend and backend after adding the keys. Google OAuth must also
be enabled in the Clerk Dashboard before the primary button can complete.

## Production

Store `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
`CLERK_AUTHORIZED_PARTIES` in Google Secret Manager. The Cloud Run deployment
script mounts them into the API and sets `CLERK_AUTH_REQUIRED=1`. This makes a
missing or invalid auth configuration a deployment failure instead of silently
leaving product APIs open.

Build the frontend with the production publishable key:

```text
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
```

The publishable key is safe to include in the browser bundle. Never expose or
commit `CLERK_SECRET_KEY`.

### Production cutover and rollback

Keep Development and Production Clerk credentials in separate Secret Manager
secrets. The production deployment can select the production secrets without
copying values or replacing the Development versions:

```bash
export CLERK_PUBLISHABLE_SECRET_NAME=CLERK_PRODUCTION_PUBLISHABLE_KEY
export CLERK_SECRET_SECRET_NAME=CLERK_PRODUCTION_SECRET_KEY
export CLERK_AUTHORIZED_PARTIES_SECRET_NAME=CLERK_PRODUCTION_AUTHORIZED_PARTIES
```

Run `server/scripts/deploy-cloud-run.sh` with those variables when the public
frontend is ready. Omitting them preserves the Development secret bindings.
Cloud Run revision traffic provides the rollback boundary: move traffic back to
the last verified Development revision if the production sign-in smoke test
fails.

Do not send public traffic to a Production Clerk revision until the frontend is
available over HTTPS at an origin listed in
`CLERK_PRODUCTION_AUTHORIZED_PARTIES`. A production frontend built with the live
publishable key and an API revision using Development Clerk credentials cannot
authenticate successfully, and the inverse combination also fails.

## Branding

The product does not render Clerk's prebuilt sign-in, sign-up, or user-menu
components, so no third-party badge or logo appears in the PodToClips interface.
Configure the PodToClips logo and custom domain in the Clerk Dashboard as well,
so OAuth consent, verification email, and account-domain touchpoints use the
same company identity.
