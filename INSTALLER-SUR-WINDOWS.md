# Installer et utiliser NIKOUS sous Windows

Ce guide est pensé pour une installation personnelle, sans terminal à utiliser au quotidien. NIKOUS garde ses données sur le PC et ne demande ni compte, ni clé API, ni abonnement. **Node.js 18 ou plus récent** est le seul prérequis.

## 1. Installer Node.js (une seule fois)

1. Ouvre <https://nodejs.org/>.
2. Télécharge la version **LTS** pour Windows et lance le fichier téléchargé.
3. Accepte les réglages proposés par défaut jusqu’à la fin de l’installation.
4. Si l’installateur le demande, ferme puis rouvre ta session Windows.

Le bouton de démarrage NIKOUS vérifie automatiquement que Node.js est disponible. S’il manque, il ouvre le site officiel.

## 2. Télécharger et décompresser NIKOUS

1. Sur la page GitHub du projet, ouvre **Code**, puis **Download ZIP**.
2. Dans l’Explorateur de fichiers, ouvre le dossier **Téléchargements**.
3. Fais un clic droit sur l’archive NIKOUS et choisis **Extraire tout…**.
4. Garde le dossier extrait dans un emplacement facile à retrouver, par exemple `Documents\NIKOUS`. Ne lance pas le fichier `.bat` directement depuis l’archive ZIP.

Le dossier doit contenir `Demarrer-NIKOUS.bat`, `server`, `public` et `package.json`.

## 3. Démarrer et ouvrir l’assistant

Double-clique sur **Demarrer-NIKOUS.bat**. Une fenêtre de démarrage réduite se lance, puis NIKOUS s’ouvre dans le navigateur à l’adresse `http://127.0.0.1:3000`.

Laisse le serveur tourner pendant que tu utilises l’assistant. Pour fermer NIKOUS, double-clique sur **Arreter-NIKOUS.bat**. Le serveur reste uniquement sur le PC : il n’est pas publié sur Internet.

### Créer un raccourci sur le Bureau

Double-clique sur **Creer-raccourci-bureau.bat**. Un raccourci NIKOUS est créé sur ton Bureau avec l’icône du projet. À partir de là, utilise ce raccourci pour le lancer.

### Démarrer automatiquement avec Windows (facultatif)

1. Appuie sur `Windows + R`.
2. Tape `shell:startup`, puis valide.
3. Copie le raccourci NIKOUS du Bureau dans le dossier qui vient de s’ouvrir.

Windows lancera alors NIKOUS à l’ouverture de ta session. Tu peux retirer le raccourci de ce dossier à tout moment pour désactiver le démarrage automatique.

## 4. Utiliser NIKOUS en français

Écris comme dans une conversation. Quelques exemples :

- `liste les fichiers` · `lis compte-rendu.txt` · `crée dossier Archives`
- `crée fichier idées.txt avec appeler le garage demain`
- `état du système` · `liste des processus` · `quelle heure est-il`
- `ouvre le dossier Documents` · `ouvre le document devis.xlsx` · `ouvre Word` · `ouvre Excel`
- `calcule sqrt(81) + pi` · `note : acheter du café` · `mes notes`
- `rappelle-moi dans 20 minutes de faire une pause`
- `chaque lundi à 09:00 : état du système`
- `météo à Paris` · `heure à Europe/Paris`
- `aide` pour afficher plus d’exemples

Tu peux enchaîner plusieurs demandes avec **puis** (six au maximum). Les rappels et tâches qui se déclenchent affichent une notification dans l’interface et apparaissent dans `historique des rappels`.

Par défaut, les fichiers et chemins sont limités au dossier de ton profil Windows (`C:\Users`). Les documents et dossiers publics présents sous cette racine sont également accessibles selon les droits de ta session.

## 5. Mode administrateur — contrôle total

Le mode administrateur élargit la racine de fichiers à `C:\` et active l’accès complet aux commandes qui ne sont pas globalement bloquées. Utilise-le uniquement si tu comprends les conséquences d’une commande et si tu fais confiance à cette installation.

1. Ferme d’abord un éventuel serveur NIKOUS déjà lancé avec **Arreter-NIKOUS.bat**.
2. Fais un clic droit sur **Demarrer-NIKOUS-Admin.bat** et choisis **Exécuter en tant qu’administrateur** (ou double-clique et accepte la demande de Windows).
3. Valide la fenêtre de contrôle de compte d’utilisateur (UAC).

Les confirmations restent visibles pour les commandes hors liste blanche quand le mode sûr est actif. Même en mode administrateur, NIKOUS refuse toujours les commandes de destruction globale connues (formatage, suppression récursive d’une racine, arrêt système, etc.). Le bouton de mode dans l’interface permet également de repasser en mode sûr.

## 6. Microphone et voix

Le bouton 🎙 démarre une conversation : parle, NIKOUS transcrit ta phrase localement, répond à voix haute, puis se remet à l’écoute. Arrête la session en retouchant le bouton ⏹. Le navigateur ne transmet pas ta voix à un service cloud.

Chrome récent est recommandé pour la reconnaissance intégralement sur l’appareil. Au premier démarrage vocal, le navigateur peut demander l’autorisation d’installer le pack français fr-FR ; le téléchargement est unique et, une fois le pack installé, la reconnaissance fonctionne hors ligne. Si tu refuses ou si le navigateur ne propose pas cette fonction locale, NIKOUS n’utilisera pas de transcription distante.

Pour parler, autorise le microphone dans la fenêtre du navigateur. Si nécessaire, ouvre les paramètres du site via l’icône de cadenas près de l’adresse. Dans un aperçu intégré, utilise **Ouvrir dans un nouvel onglet**. La synthèse vocale sélectionne uniquement une voix française installée localement ; si aucune voix n’est disponible, ajoute une voix française dans les paramètres de parole de Windows. Le bouton **Réponses vocales locales** active aussi la lecture lors des conversations écrites.

## 7. Dépannage

- **Le navigateur ne s’ouvre pas** : vérifie que `http://127.0.0.1:3000` est accessible et que la fenêtre NIKOUS n’a pas été fermée.
- **Le port 3000 est déjà utilisé** : ferme l’autre serveur, ou arrête NIKOUS avec `Arreter-NIKOUS.bat`, puis relance-le.
- **« Node.js 18+ est requis »** : installe ou mets à jour la version LTS depuis <https://nodejs.org/>, puis ouvre une nouvelle session Windows.
- **Un fichier n’est pas trouvé** : vérifie son nom et son emplacement sous `C:\Users`. Les chemins extérieurs sont bloqués en mode sûr.
- **La météo ne répond pas** : cette fonction utilise Internet (Open-Meteo). La connexion est aussi nécessaire une seule fois si Chrome doit télécharger le pack fr-FR local ; ensuite la conversation vocale fonctionne hors ligne. Les fichiers, calculs, notes et rappels restent locaux.
- **La conversation vocale locale ne démarre pas** : utilise Chrome à jour, autorise le microphone, puis accepte le pack fr-FR si le navigateur te le propose. Si aucune voix locale française n’est disponible, installe-la dans les paramètres de parole de Windows. NIKOUS ne basculera jamais vers la reconnaissance cloud.
- **Le démarrage administrateur indique qu’une instance existe déjà** : arrête-la d’abord avec `Arreter-NIKOUS.bat`, puis relance le kit administrateur.

## 8. Mettre à jour NIKOUS en gardant tes données

1. Arrête le serveur avec **Arreter-NIKOUS.bat**.
2. Télécharge et décompresse la nouvelle version dans un nouveau dossier.
3. Copie le dossier `data` de l’ancienne version vers la nouvelle pour conserver notes, préférences, rappels, routines et historique.
4. Lance **Demarrer-NIKOUS.bat** depuis le nouveau dossier.
5. Quand tu as vérifié la nouvelle version, tu peux archiver l’ancien dossier.

Ne partage pas le dossier `data` si tu ne veux pas partager tes notes et ton historique. Il est volontairement ignoré par le dépôt Git.
