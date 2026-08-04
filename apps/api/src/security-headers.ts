import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

/**
 * Every directive here is deliberately restrictive rather than a placeholder — this API never
 * serves application HTML (only JSON and the Swagger docs page at `/docs`), so there is no
 * legitimate reason for it to load a script, a stylesheet, a frame, or a plugin from anywhere.
 * `defaultSrc: 'none'` plus explicit `'self'` only where Swagger's own assets genuinely need it
 * is the actual policy, not `*` dressed up as one.
 */
export function buildHelmetMiddleware(options: { production: boolean }) {
  return helmet({
    // Same-site (not same-origin, helmet's default) permits the browser to load a cross-origin
    // subresource like the admin media preview `<img src>` from the API even though it's a
    // different origin than the web app — CORS allowing the request doesn't satisfy this
    // separate, browser-enforced check on its own.
    crossOriginResourcePolicy: { policy: 'same-site' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        // Swagger UI (mounted at /docs) needs to load its own bundled script/style/image assets.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        objectSrc: ["'none'"],
        ...(options.production ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Only meaningful — and only claimed — when the deployment is actually served over HTTPS,
    // which the production assumption in docs/security-production.md requires; asserting it in
    // development would be a lie about a plaintext-HTTP local server.
    hsts: options.production ? { maxAge: 15_552_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
  });
}

/**
 * Helmet 8 dropped `Permissions-Policy` support (the successor to the deprecated
 * `Feature-Policy`) — set explicitly here instead. This API's clients never need camera,
 * microphone, geolocation, or payment-handler access; every feature is denied outright rather
 * than left to browser defaults.
 */
export function permissionsPolicyMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  next();
}
