# Security Policy

## Supported Versions

This project is currently pre-1.0. Security fixes target the latest published version only.

## Reporting a Vulnerability

Please do not open a public issue for security-sensitive reports.

Until a dedicated security contact is configured, report vulnerabilities by opening a private advisory on the GitHub repository or contacting the maintainer listed in `package.json`.

When reporting, include:

- affected version or commit
- operating system
- reproduction steps
- expected impact
- whether the issue requires local access or can be triggered remotely

## Local Service Scope

The mascot control API listens on `127.0.0.1` by default. Do not expose it to public networks unless you add authentication and understand the risk.
