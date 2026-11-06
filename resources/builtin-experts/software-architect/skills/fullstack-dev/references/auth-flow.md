---
name: fullstack-dev-auth-flow
description: Use when designing authentication, service identity propagation, authorization, data permissions, sessions, tokens, or security boundaries.
license: MIT
metadata:
  version: "2.0.0"
---

# Authentication and Authorization (Language-Neutral)

## Separate the concerns

1. **Authentication** — establish who/what is calling.
2. **Identity propagation** — carry verified identity across gateway, services, jobs, and messages.
3. **Authorization** — decide whether the actor may perform an action on a resource.
4. **Data permission** — constrain which rows/fields/tenants are visible.
5. **Audit** — record security-sensitive decisions and mutations.

Do not treat possession of a token as business permission.

## MUST rules

- Inspect existing gateway filters, headers, context objects, middleware/interceptors, and permission queries before choosing a protocol.
- Keep credentials out of URLs and logs; protect secrets at rest and in transit.
- Define missing, invalid, expired, revoked, and insufficient-permission behavior separately.
- Scope service-to-service credentials and prevent confused-deputy behavior.
- Make authorization decisions close to the protected resource and test both allow and deny paths.
- State logout/revocation, key rotation, replay, clock skew, and session expiry behavior.

## ADAPT

The adapter maps these responsibilities to filters/interceptors/middleware, token/session libraries, context propagation, and policy/data-query layers. JWT, OAuth, sessions, Spring Security, or a custom token are not defaults; they require repository or product evidence.

## Review checklist

- [ ] Gateway, service, business, and data permission boundaries are explicit.
- [ ] Identity cannot be supplied by an untrusted request field.
- [ ] Background jobs and message consumers have an identity/audit policy.
- [ ] 401/403/404 masking behavior is intentional.
- [ ] Permission changes, cache invalidation, and audit retention are covered.
