# Security — running songbird safely

songbird is built to run **on your own computer or a trusted home/office network**, over plain
HTTP. In that setting the defaults are fine and there's nothing to configure. This page is for the
one case that needs care: **reaching songbird from outside that trusted network** (e.g. over the
internet).

## The default posture

- **Self-hosted, single unit.** songbird runs as one process; your notes, tags, and accounts live
  in your `DATA_DIR` and never leave your machine. The only thing it talks to over the network is
  **Concord** (`CONCORD_BASE_URL`), for Scripture and places.
- **Accounts.** The first person to sign up is the owner; everyone else gets their own private
  account. Passwords are stored hashed, never in plaintext — but anyone who can *reach* the site
  can try to log in, so use a strong password.
- **The session cookie** is `HttpOnly` and `SameSite=lax`. It is **not** marked `Secure` by default,
  which is correct for plain-HTTP LAN use (a `Secure` cookie would never be sent over HTTP, locking
  you out). Set `COOKIE_SECURE=1` only once you're on HTTPS (below).
- **Binding.** songbird listens on `0.0.0.0:8077` (`PORT`/`BIND_HOST`), so it's reachable from other
  machines on your network. That's intended for LAN use; keep it behind your router/firewall.

songbird is **not** designed for hostile, public, multi-tenant hosting — that's explicitly out of
scope. The model is "self-hosted for you and people you trust."

## Exposing songbird beyond the LAN — the checklist

If you want to reach songbird from outside your trusted network, do all of these:

1. **Put it behind HTTPS.** Terminate TLS with a reverse proxy (e.g. Caddy, nginx, or Traefik) in
   front of songbird; don't expose port 8077 directly. Caddy will get you a certificate
   automatically.
2. **Set `COOKIE_SECURE=1`.** Once you're on HTTPS, this makes the session cookie travel only over
   HTTPS. (Leave it `false` until TLS is actually in place, or logins will appear to fail.)
3. **Use strong, unique account passwords.** Anyone who can reach the URL can attempt to log in.
4. **Keep Concord internal.** Only songbird needs to reach Concord (`CONCORD_BASE_URL`). Don't
   publish Concord's port to the internet — put it on an internal/Docker network.
5. **Restrict who can reach it.** A firewall rule, VPN, or your proxy's access controls is the
   difference between "my household" and "the whole internet." Prefer a VPN if it's just for you.
6. **Back up your `DATA_DIR`.** Your notes and accounts live there. Back it up; losing it loses them.

## Reporting a problem

This is a personal, self-hosted project. If you find a security issue, please open an issue (or
contact the maintainer) rather than posting exploit details publicly.
