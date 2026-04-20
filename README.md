# Prospect Qualifier — astr.studio

Mini site de qualification de prospects pour agence web.
Questionnaire multi-étapes premium qui collecte les besoins du prospect et envoie un email structuré via Resend.

---

## Stack

- **Frontend** : HTML · CSS · JavaScript vanilla (aucun framework)
- **Backend** : Node.js · Express
- **Upload** : Multer
- **Email** : Resend
- **Env** : dotenv
- **ID** : uuid

---

## Arborescence

```
prospect-qualifier/
  public/
    index.html        # SPA multi-étapes
    styles.css        # Design system astr.studio
    app.js            # Logique frontend
    assets/           # Ressources statiques (logo, etc.)
  uploads-temp/       # Fichiers temporaires (auto-nettoyés)
  server.js           # API Express
  package.json
  .env.example
  .gitignore
  README.md
```

---

## Installation

```bash
cd prospect-qualifier
npm install
```

---

## Configuration

Copiez `.env.example` en `.env` et remplissez les variables :

```bash
cp .env.example .env
```

| Variable          | Description                                             | Exemple                        |
|-------------------|---------------------------------------------------------|--------------------------------|
| `PORT`            | Port du serveur                                         | `3000`                         |
| `RESEND_API_KEY`  | Clé API Resend (resend.com)                            | `re_xxxx...`                   |
| `TO_EMAIL`        | Email qui reçoit les prospects                          | `contact@votreagence.fr`       |
| `FROM_EMAIL`      | Email expéditeur (domaine vérifié dans Resend)         | `questionnaire@votreagence.fr` |
| `AGENCY_NAME`     | Nom de l'agence (apparaît dans les emails)             | `astr.studio`                  |
| `MAX_FILE_SIZE_MB`| Taille maximale par fichier en Mo                      | `10`                           |

> **Important** : Le domaine utilisé dans `FROM_EMAIL` doit être vérifié dans votre compte Resend.

---

## Lancement en local

```bash
npm start
```

Ou avec rechargement automatique (Node 18+) :

```bash
npm run dev
```

Puis ouvrez [http://localhost:3000](http://localhost:3000)

---

## Tester l'envoi du formulaire

1. Remplissez toutes les variables `.env`
2. Lancez le serveur : `npm start`
3. Ouvrez [http://localhost:3000](http://localhost:3000)
4. Complétez le questionnaire en 11 étapes
5. Vérifiez la boîte mail configurée dans `TO_EMAIL`

Pour tester sans Resend configuré, le serveur répondra avec une erreur 500 mais loggera les données reçues dans la console.

---

## Déploiement

### Render / Railway / Fly.io

1. Pushez le projet sur GitHub
2. Connectez le repo au service
3. Définissez les variables d'environnement dans l'interface du service
4. Le serveur démarre automatiquement avec `npm start`

### VPS (nginx + PM2)

```bash
# Installer PM2
npm install -g pm2

# Lancer l'application
pm2 start server.js --name prospect-qualifier

# Configurer nginx en reverse proxy vers localhost:3000
```

### Variables d'environnement requises en production

Toutes les variables du `.env.example` doivent être définies.

---

## Sécurité

- **Honeypot** : champ caché qui filtre les bots
- **Timing check** : rejet si soumission < 20 secondes après chargement
- **Validation MIME + extension** côté serveur
- **Limite taille fichier** configurable via `MAX_FILE_SIZE_MB`
- **Nettoyage automatique** des fichiers temporaires après envoi

---

## Types de fichiers acceptés

`JPG · JPEG · PNG · WEBP · SVG · PDF · DOC · DOCX`

Maximum 10 fichiers · taille configurable par `MAX_FILE_SIZE_MB`
