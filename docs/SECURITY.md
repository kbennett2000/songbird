# songbird — Security posture & threat model

songbird is a **personal, self-hosted** app for annotating Scripture. This document states the
security posture it is **designed for**, the assumptions baked into its defaults, and the
checklist for the one scenario those defaults do **not** cover — exposing it beyond a trusted
network.

It is deliberately honest about what is *not* defended, because a stated assumption is safer
than a silent one.

---

## 1. Intended deployment: a trusted LAN, single unit

songbird is built to run as **one process on a private network you control** — your home or
study LAN — reached over plain HTTP, typically same-host alongside Concord (`docker compose
up`). The threat model assumes:

- The network is **trusted**: no hostile parties on the LAN segment, no untrusted users sharing
  the host.
- songbird is **not exposed to the public internet** as shipped.
- There is **one to a few known users** (the maintainer and household), not anonymous signups at
  scale.

Every default below is correct under those assumptions. Section 8 is what changes the moment
any of them stops holding.

## 2. What songbird protects (and what it doesn't hold)

songbird's own SQLite database (under `DATA_DIR`) holds the only sensitive data:

- **User credentials** — passwords stored only as **Argon2** hashes (never plaintext, never
  reversible).
- **Session tokens** — random server-side tokens (see §4).
- **Private notes** — the user's annotations on Scripture.

What songbird **does not** hold, by invariant (see `CLAUDE.md`):

- **No Bible text.** Scripture comes from Concord over HTTP at request time; none is stored or
  shipped in songbird.
- **No third-party secrets, no payment data, no PII beyond a username.**

So the blast radius of a songbird compromise is: this user's notes and their password hash —
not Scripture data (Concord is read-only and data-only) and not anyone else's account.

## 3. Authentication

- Passwords are hashed with **Argon2** (`passlib`, `songbird/core/passwords.py`). The
  deliberate computational cost of Argon2 is the primary brute-force mitigation (see §6).
- **Login does not leak user existence.** A wrong password and an unknown username return the
  **same** `401 INVALID_CREDENTIALS` (`songbird/api/auth.py`), so an attacker can't enumerate
  valid usernames through the login endpoint.
- The **entire app is gated** behind an authenticated session. Only liveness (`/healthz`) and
  the auth endpoints themselves are open; every reading, annotation, search, and geography route
  requires a logged-in user (`songbird/main.py`). Concord stays user-unaware — the gate is
  purely songbird's.

## 4. Sessions & the session cookie

- Sessions are **DB-backed**: a cryptographically random token
  (`secrets.token_urlsafe(48)` → 384 bits) is the source of truth in songbird's database, not a
  signed/stateless token. **Logout is a real server-side revocation** — the row is deleted, so
  the cookie is dead even if it were copied.
- TTL is **30 days**; expiry is checked on every read, so an expired token never authenticates
  even if its row lingers.
- The cookie (`songbird/core/cookies.py`) is set with:
  - **`HttpOnly`** — not readable from JavaScript, blunting token theft via XSS.
  - **`SameSite=Lax`** — see §5.
  - **`Secure`** — **configurable** via `COOKIE_SECURE` (default `false`). See §5 and §8.

## 5. CSRF and the `Secure` flag

- **`SameSite=Lax` is songbird's CSRF mitigation.** A Lax cookie is not sent on cross-site
  subrequests (the dangerous vector — a form/`fetch` POST from another origin), so a malicious
  page cannot ride the user's session to mutate songbird state. State-changing requests are all
  `POST`/`PATCH`/`DELETE` under `/api/v1`, which Lax does not attach cross-site.
- **There are deliberately no CSRF tokens.** With `SameSite=Lax` on an `HttpOnly` session cookie
  and a same-origin SPA, CSRF tokens would add machinery without changing the outcome for this
  posture. This is a conscious trade, not an oversight.
- **`Secure` is `false` by default** because the intended deploy is **LAN HTTP** — a `Secure`
  cookie would simply never be sent over plain HTTP, breaking login. The instant TLS fronts
  songbird, set **`COOKIE_SECURE=1`** (§8) so the session cookie is HTTPS-only. `SameSite=Lax`
  is not a substitute for `Secure` under TLS — both matter once you have HTTPS.

## 6. Rate limiting

songbird's login endpoint currently has **no rate limit or lockout**. The mitigations that make
this defensible on a trusted LAN:

- **Argon2's cost.** Each password verification is intentionally expensive (memory- and
  time-hard), so online brute force is slow by construction — orders of magnitude slower than a
  fast-hash endpoint.
- **No user enumeration** (§3) raises the attacker's work: both the username and the password
  are unknown.
- **The trusted-LAN assumption** (§1): there is no anonymous internet attacker in the intended
  deployment.

This is acceptable **only** under the LAN posture. If songbird is exposed (§8), add a throttle
or lockout — it is cheap insurance once anonymous traffic can reach `/api/v1/auth/login`.

## 7. The Concord trust boundary

- songbird reaches Concord **only over HTTP**, through one configured client at
  `CONCORD_BASE_URL` (`songbird/concord/client.py`). Concord's location is **pure config**, not
  an assumption — same host or any LAN machine.
- songbird sends Concord **no secrets and no user data** — only canonical Scripture coordinates
  and search terms. A compromised or hostile Concord cannot read songbird's notes or
  credentials; the worst it can do is return wrong/garbage Scripture, which is a correctness
  concern, not a credential-disclosure one.
- If Concord is unreachable, songbird **errors** — it never falls back to a bundled copy or
  offline mode (`CLAUDE.md` invariant 3). There is no offline attack surface to harden because
  there is no offline mode.
- **`CONCORD_BASE_URL` should itself point at a trusted Concord on a trusted network.** Treat it
  as part of the trusted boundary; don't point it at an untrusted host.

## 8. Checklist: exposing songbird beyond a trusted LAN

If songbird must be reachable from an untrusted network (the internet, a shared/hostile LAN),
the §1 assumptions no longer hold. Do **all** of the following before exposing it:

1. **Terminate TLS.** Put songbird behind a reverse proxy (Caddy, nginx, Traefik) that serves
   HTTPS. songbird speaks plain HTTP; the proxy owns certificates.
2. **Set `COOKIE_SECURE=1`** so the session cookie is only ever sent over HTTPS (§5).
3. **Add login rate limiting / lockout** (§6) — at the proxy and/or in the app — now that
   anonymous traffic can reach the auth endpoint.
4. **Front it with a reverse proxy** regardless of TLS: it is the place for request limits,
   IP allow-lists, and access logging, and it keeps uvicorn off the open internet directly.
5. **Lock down the network**: expose only the proxy's port; keep Concord and `DATA_DIR`
   unreachable from outside.
6. **Back up and protect `DATA_DIR`** — it holds the password hashes, session tokens, and all
   private notes. Its file permissions are the last line of defense for the data at rest.

Until every item applies, treat songbird as a **LAN-only** application.

## 9. Reporting

songbird is a personal project. Security concerns: open an issue at
<https://github.com/kbennett2000/songbird> (omit exploit details for anything sensitive) or
contact the maintainer directly.
