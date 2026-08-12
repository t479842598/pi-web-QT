# Security Policy

## Supported versions

Security fixes target the latest release.

## Reporting a vulnerability

Please do not publish credentials, private server URLs, session content, or exploit details in a public issue. Contact the repository maintainer privately through the security-reporting method configured on the hosting repository.

Include the affected version, reproduction steps, impact, and a minimal redacted example. Do not test against systems you do not own or have permission to access.

## Deployment guidance

- Never expose Pi Web over unencrypted public HTTP.
- Use HTTPS with a valid certificate chain or a trusted VPN.
- Use a strong `PI_WEB_PASSWORD` and restrict `PI_WEB_ALLOWED_HOSTS`.
- Treat Pi Web as a high-privilege administrative service.
