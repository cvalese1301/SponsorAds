# Security

Questo tool usa credenziali Meta sensibili.

## Prima di caricare su GitHub

- Verifica che `.env` non sia tracciato da Git.
- Usa `.env.example` per documentare le variabili senza valori reali.
- Crea il repository come privato se il tool resta interno.
- Rigenera eventuali token o secret condivisi in chat, screenshot o log.

## Segreti da proteggere

- `META_APP_SECRET`
- `META_ACCESS_TOKEN`
- `META_PAGE_ACCESS_TOKEN_*`

## Rotazione consigliata

Per uso interno, ruota i token quando:

- una persona lascia il team;
- un token e stato incollato in chat o mostrato in screenshot;
- passi da test locale a hosting online;
- ricevi errori di token scaduto o invalidato da Meta.
