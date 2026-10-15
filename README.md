# PR Dashboard

App macOS locale pour suivre les pull requests à review sur plusieurs repos GitHub.

Elle liste les PR ouvertes des repos choisis, filtrées par label si besoin. Pour chacune, elle montre où tu en es : jamais vue, commits depuis ta review, réponses à tes commentaires. Elle lance aussi deux skills Claude en headless :

- `pr-brief`, automatiquement sur chaque PR hors draft et hors des tiennes ;
- `deep-review`, sur un clic.

## Prérequis

- macOS sur Apple Silicon.
- Node 20 ou plus, utilisé au build et embarqué dans l'app.
- Rust et Xcode, pour compiler Tauri.
- `gh`, connecté au compte GitHub qui a accès au repo.
- `claude`, la CLI Claude Code, connectée.

`gh` et `claude` sont cherchés dans le `PATH` de ton shell de login.

## Installer

```bash
npm install
npm run app:install
```

L'app est compilée puis copiée dans `/Applications/PR Dashboard.app`.

## Utiliser

Au premier lancement, les **Réglages** s'ouvrent :

- **Repos suivis.** La recherche propose les repos de tes organisations GitHub et les tiens, tels que `gh` les voit. Un `owner/name` tapé à la main marche aussi.
- **Labels, par repo.** Une PR est listée si elle porte au moins un des labels cochés. Aucun label coché : toutes les PR ouvertes du repo.
- **Brief automatique**, activable ou non.

Quand plusieurs repos ou plusieurs labels sont suivis, des filtres apparaissent au-dessus de la liste.

## Coûts observés

- `pr-brief` : 0,40 à 1 $ et environ une minute par PR.
- `deep-review` : environ 3 $ et 6 minutes sur une petite PR.

Un brief n'est relancé que quand la PR reçoit de nouveaux commits.

## Où sont les choses

- **Données** : `~/Library/Application Support/fr.lefigaro.pr-dashboard/`.
  - `data/settings.json` : les réglages.
  - `data/state.json` : ton suivi local et l'index des analyses.
  - `data/analyses/` : les briefs et deep reviews en markdown.
  - `repos/` : un clone par repo suivi, créé au premier brief. Les analyses tournent dans un `git worktree` de ce clone, jamais dans ton checkout.
- **Skills** : `claude-plugin/skills/`. Ce sont des copies de `~/.claude/skills`. Après une modification de tes skills, `npm run sync:skills` puis `npm run app:install`.

## Garde-fous des analyses

- `claude -p` tourne en `--permission-mode dontAsk` : tout outil hors liste est refusé.
- `pr-brief` est en lecture seule.
- `deep-review` peut aussi lancer `node` et écrire des fichiers de travail.
- Interdits partout : `Edit`, `git push`, `git commit`, `gh pr comment`, `gh pr review`, `gh api`.
- Un prompt système interdit de publier quoi que ce soit.

## Serveur permanent

L'app démarre son serveur à l'ouverture et l'arrête à la fermeture. Pour que les briefs tournent app fermée, installe l'agent `launchd`. L'app réutilisera ce serveur.

```bash
npm run launchd:install
```

```bash
npm run launchd:uninstall
```

Les logs de l'agent sont dans `~/Library/Logs/pr-dashboard.log`.

## Développer

Lancer le serveur depuis les sources, puis ouvrir http://localhost:4300 :

```bash
npm start
```

Variables utiles :

- `PORT` : le port, 4300 par défaut.
- `PR_DASHBOARD_HOME` : le dossier des données.
- `PR_DASHBOARD_NO_AUTO=1` : désactive le brief automatique par défaut.
- `PR_DASHBOARD_DEBUG=1` : logue chaque requête.

Pour tester sans toucher aux vraies données, utiliser un autre port et un autre dossier :

```bash
PORT=4301 PR_DASHBOARD_HOME=/tmp/pr-dashboard-test PR_DASHBOARD_NO_AUTO=1 npm start
```

Autres scripts :

- `npm run app:build` : compile l'app sans l'installer.
- `npm run icons` : régénère les icônes depuis `assets/icon.png`.

## Structure

- `server.js` : le serveur HTTP, la file d'analyses et l'appel à `claude`.
- `public/index.html` : la page, en Preact sans build.
- `claude-plugin/` : les skills embarquées.
- `src-tauri/` : l'app Tauri. Elle lance le Node embarqué en sidecar et affiche la page.
- `scripts/` : build du sidecar, icônes, installation, `launchd`.
