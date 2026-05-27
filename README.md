# Meta Bulk Sponsor Tool

Webtool interno per creare inserzioni Meta in bulk partendo da post gia pubblicati su Facebook e Instagram.

## Cosa fa

- Legge gli account pubblicitari disponibili.
- Mostra campagne, gruppi inserzioni e regole automatiche.
- Recupera le fonti post dal Business Manager collegato all'account pubblicitario.
- Divide i post in tab Facebook e Instagram.
- Crea inserzioni in pausa o attive.
- Prova ad applicare una regola esistente aggiungendo i nuovi Ad ID alle regole basate su `ad.id`.

## Requisiti

- Node.js 20 o superiore.
- Una Meta App con accesso alla Marketing API.
- Un access token valido con permessi adeguati.

Permessi usati normalmente:

- `ads_read`
- `ads_management`
- `business_management`
- `pages_show_list`
- `pages_read_engagement`

## Setup locale

1. Copia `.env.example` in `.env`.
2. Inserisci nel file `.env` i valori reali.
3. Avvia il server:

```bash
npm start
```

4. Apri:

```text
http://localhost:4173/index.html
```

Per cambiare porta:

```bash
PORT=4185 npm start
```

Su PowerShell:

```powershell
$env:PORT=4185; npm start
```

## Uso interno

Questo progetto e pensato per uso interno. Tieni il repository privato se contiene log, configurazioni o dettagli operativi sensibili.

Non committare mai:

- `.env`
- access token
- app secret
- page token
- screenshot che mostrano token o configurazioni private

## Note sui token

I token generati dal Graph API Explorer scadono rapidamente. Per un uso piu comodo, usa un long-lived user token e recupera da quello i page token aggiornati.

Se un token o un app secret viene condiviso per errore, rigeneralo dal pannello Meta.
