---
name: fullstack-dev-environment-management
description: Use when designing configuration, secrets, profiles, service discovery, runtime environments, or local-to-production differences.
license: MIT
metadata:
  version: "2.0.0"
---

# Environment and Configuration (Language-Neutral)

- Separate configuration from code and validate required values at startup.
- Keep secrets out of source control, URLs, logs, images, and generated artifacts.
- Define precedence among defaults, local, test, staging, and production configuration.
- Document ownership, reload behavior, type/format validation, rotation, and rollback for each operational setting.
- Use explicit allow-lists for origins, hosts, callbacks, and downstream services.
- Ensure local/test configuration cannot silently point at production data.

## ADAPT

Map these rules to the repository’s config center, profile files, environment variables, flags, secret manager, framework binding, and deployment manifests. `bootstrap*.yml`, Nacos, `.env`, Helm, K8s, and system properties are implementation choices or **PROJECT FACTS**, not universal defaults.
