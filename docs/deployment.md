# Deploying the PWA on Netlify

The supported deployment is the root of a dedicated HTTPS origin, **https://latch.theqrl.org/**. Manifest identity, scope and launch URL are `/`; subpath hosting is not supported. Do not share the origin with an online wallet or unrelated application.

## Connect the repository

1. Import the repository into Netlify and select the intended release branch. The root `netlify.toml` sets Node 22, runs `npm ci && npm test && npm run build:pwa`, and publishes `apps/pwa/dist`.
2. Configure `latch.theqrl.org` as the custom domain, set the DNS records Netlify supplies, and wait for its TLS certificate. Repository configuration cannot establish DNS ownership or issue the certificate itself.
3. Leave snippet injection, analytics/RUM scripts and asset transformations disabled. Do not add authentication/interstitial redirects to the production app or its resources. Build output must be served unchanged.
4. Restrict deployment/account access and protect the release branch. A compromised publisher can serve malicious code; offline asset digests do not authenticate the publisher.
5. Verify the deployed build below, then complete device acceptance before entering real keys.

No application secrets or RPC credentials are needed as Netlify environment variables. Use a separate staging origin and disposable keys for previews. Moving to another origin does not move an existing vault or its installed icon.

## Routing and headers

All views use application state at `/`, with no history-router paths. There is intentionally no catch-all SPA rewrite. Missing scripts, workers, fonts or manifests must return a real 404, rather than HTML with a successful status.

Vite copies `shared/assets/_headers` into the publish directory. Netlify applies:

- A CSP matching the HTML policy, plus `frame-ancestors 'none'`; framing denial, MIME sniffing protection, no-referrer and same-origin isolation headers.
- Permissions for the app's camera, screen wake lock, device credentials and clipboard writing; unrelated listed capabilities are disabled. OS/browser permission prompts still apply.
- HSTS for this hostname, without subdomain or preload commitments.
- HTTP revalidation for files, explicit service-worker scope and MIME types, and no CDN storage for `sw.js` and `release.json`.

HTTP cache policy does not expire the application's explicitly managed offline Cache Storage. Normal service-worker operation reads the pinned cache without a network fallback. Browser eviction, site-data deletion and OS behavior can still remove it. Browser-managed worker update requests remain possible on reconnection; headers are not an air-gap enforcement mechanism.

`npm run build:pwa` finalizes per-file SHA-256 digests, verifies the worker's install against the built files, and checks hosting configuration. Do not deploy the output of invoking Vite alone or edit generated output afterwards. Netlify publishes a deployment atomically, but requests spanning two deployments can still see mixed files; integrity checks must fail safely and the empty installation may need a retry. Existing installed releases rely on their own caches, not indefinite retention of old files on the host.

## Verify after deployment

Use the exact source revision and lockfile that produced the deployment:

```sh
npm ci
npm test
npm run build:pwa
npm run check:deployment -- https://latch.theqrl.org
```

The read-only deployment check compares served bytes with the local build, checks headers and content types, verifies the root document, and rejects missing assets served as an SPA shell. Redirects fail the check: pass the final production origin. Rebuilding a different revision or with different build inputs should fail byte comparison.

Then use an empty test device: install and first launch online, check offline files in the Home Screen app, request storage protection, disconnect as described in the README, close/reopen and test signing and backup recovery with disposable keys. A desktop HTTP check cannot establish mobile storage retention or camera/authenticator compatibility.

For local UI testing, `npm run preview` serves the production bundle but does not emulate Netlify's response headers. Test the actual hosted headers before release. HTTPS tunnels must serve the production preview without a warning page and retain the same origin throughout installation.

See [Updating Latch](updating.md) for existing installations. Do not instruct users to clear site data or reconnect a key-bearing instance merely to receive a new deployment.
