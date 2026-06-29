# Al-Fath School Monitoring

Telegram bot → n8n → SIM-Madrasah REST API (MySQL). Dashboard tersedia di SIM web app. See the design spec in
`docs/superpowers/specs/` and the implementation plans in `docs/superpowers/plans/`.

## Logic tests

Pure parsing/formatting logic lives in `src/` and is tested with Node's built-in
runner (no dependencies). Requires Node 18+.

    npm test

The n8n Code nodes contain copies of these functions; keep them in sync with `src/`.
