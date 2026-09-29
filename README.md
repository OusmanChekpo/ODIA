# NIKOUS — assistant local de contrôle de poste

NIKOUS est une interface de chat en français qui aide à piloter un poste local : fichiers, état du système, notes, calculs, rappels et routines. Le serveur utilise uniquement Node.js et sa bibliothèque standard. Aucune dépendance npm, compilation, clé API ou service cloud n’est nécessaire. La météo et la recherche d’un fuseau par nom de ville utilisent Open-Meteo ; elles indiquent clairement qu’une connexion est nécessaire si le service est inaccessible.

## Démarrage

Prérequis : **Node.js 18 ou plus récent**.

```sh
npm start
```

Puis ouvre <http://localhost:3000>. Aucun `npm install` n’est requis. Pour lancer les tests :

```sh
npm test
```

Pour une preview accessible depuis le navigateur Arena ou un réseau local, le serveur peut écouter sur toutes les interfaces :

```sh
HOST=0.0.0.0 PORT=3000 npm start
```

Sous Windows, utilise `Demarrer-NIKOUS.bat` ; le guide détaillé se trouve dans [`INSTALLER-SUR-WINDOWS.md`](INSTALLER-SUR-WINDOWS.md).

## Quelques commandes à essayer

| Besoin | Exemples en français |
| --- | --- |
| Fichiers | `liste les fichiers` · `lis notes.txt` · `crée fichier idées.txt avec quelques idées` · `crée dossier Archives` · `renomme ancien.txt en nouveau.txt` · `taille de notes.txt` |
| Recherche | `cherche fichier contenant budget` · `cherche "rendez-vous" dans les fichiers de Documents` |
| Poste | `état du système` · `liste des processus` · `quelle heure est-il` · `exécute commande git status` · `ouvre https://example.com` |
| Quotidien | `météo à Montréal` · `calcule sqrt(81) + pi` · `note : appeler le médecin` · `mes notes` · `heure à Europe/Paris` |
| Rappels | `rappelle-moi dans 10 minutes de faire une pause` · `chaque lundi à 09:00 : état du système` · `toutes les 30 minutes : liste des processus` |
| Routines | `crée routine matin : état du système ; liste les processus` · `exécute routine matin` · `liste les routines` |
| Discussion | `comment ça va ?` · `raconte une blague` · `qui es-tu ?` · `aide` |
| Enchaînement | `quelle heure est-il puis mes notes` (jusqu’à six actions) |

Les fichiers visibles par défaut sont bornés à la racine autorisée. Les créations et recherches utilisent des opérations Node.js natives ; la recherche dans le contenu fonctionne donc également sous Windows, sans dépendre de `grep`.

## Sécurité et confidentialité

- **Mode sûr par défaut** : sur Windows la racine est `C:\Users`, ailleurs le dossier personnel. `NIKOUS_ROOT` permet d’en choisir une autre.
- Un chemin qui sort de la racine (y compris via un lien symbolique) est refusé. Les actions de suppression de fichiers affichent une carte de confirmation à usage unique, valable deux minutes ; les dossiers ne sont jamais supprimés par cette commande.
- Les commandes en lecture seule reconnues par la liste blanche peuvent s’exécuter directement. Une commande inconnue ou un interpréteur comme `node`, `python` ou `npm` demande une confirmation. Les commandes de destruction globale sont bloquées sans exception, y compris en accès complet.
- Le bouton **Mode sûr / Accès complet** permet de modifier localement les restrictions de chemins et de commandes. L’activation demande une confirmation dans l’interface. Pour forcer le mode complet au lancement, définis `NIKOUS_FULL_ACCESS=1`. À utiliser uniquement sur une machine de confiance.
- Le serveur ne fait pas appel à une API d’IA. Les données de conversation, réglages, notes, rappels, routines et journal restent sous `data/`, ignoré par Git. Seules la météo et la résolution en ligne d’une ville en fuseau horaire demandent Internet.
- Le port HTTP n’a pas de mécanisme d’authentification : garde le serveur sur ta machine ou sur un réseau de confiance. Par défaut, il écoute sur `127.0.0.1` ; l’écoute sur `0.0.0.0` est destinée à la preview ou à un réseau local maîtrisé.

## Voix et affichage

La reconnaissance vocale utilise celle de ton navigateur en français (`fr-FR`) après une demande d’autorisation du microphone. Chrome et Edge sont recommandés. Si l’aperçu est intégré dans une iframe et bloque le microphone, le bouton **Ouvrir dans un nouvel onglet** permet de réessayer. La lecture vocale est facultative et se règle dans l’interface ; elle utilise les voix françaises installées dans le navigateur. Le thème clair/sombre et la préférence vocale sont mémorisés localement dans le navigateur.

## Structure

```text
server/
├── index.js           # Serveur HTTP natif, fichiers statiques, API JSON et SSE
├── nlu.js             # NLU français local, accents, intentions et chaînage
├── executor.js        # Routage, réponses naturelles, confirmations et journal
├── tone.js            # Reformulations et petites conversations
├── safety.js          # Listes blanches, blocages, racines et jetons
└── actions/
    ├── files.js       # Fichiers avec fs natif et chemins bornés
    ├── system.js      # État, processus, commandes et ouverture
    ├── automation.js  # Rappels, récurrences, routines et journal
    └── extras.js      # Météo, calculatrice sécurisée, notes et fuseaux
public/                 # Interface vanilla JavaScript, CSS et HTML
 test/                  # Tests node:test (22 tests, dont le test HTTP/SSE)
data/                  # Données locales ignorées par Git
assets/nikous.ico       # Icône Windows multi-tailles
scripts/                # Outils du kit Windows
```

Pour la procédure Windows pas-à-pas, les raccourcis bureau et le mode administrateur, consulte [`INSTALLER-SUR-WINDOWS.md`](INSTALLER-SUR-WINDOWS.md).
