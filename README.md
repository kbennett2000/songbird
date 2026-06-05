# songbird

A personal, self-hosted app for **annotating Scripture** — read the Bible in a translation you
choose, highlight a verse, and write a note in the margin. Find it again later by tag or by
meaning.

## Built on Concord

songbird is a **client of [Concord](https://github.com/kbennett2000/concord)**. Concord serves
the Scripture text, search, and geography over a REST API; songbird sits on top of it and is
what you write in the margins.

songbird **requires a reachable Concord instance.** It reads a single `CONCORD_BASE_URL` and
calls whatever is there — Concord can run on the same host or any other machine on your LAN, on
any port. The location is pure configuration.

If Concord is unreachable, songbird **errors** — there is no offline mode and no bundled copy of
the Bible text. The text always comes from Concord at request time.

## Status

Early, and in active development. The design canon lives in
[docs/v1/SPEC.md](docs/v1/SPEC.md); the working rules live in [CLAUDE.md](CLAUDE.md).

## License

MIT — see [LICENSE](LICENSE).
