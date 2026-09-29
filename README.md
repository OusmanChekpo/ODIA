# NIKOUS — assistant local de contrôle de poste

NIKOUS est un assistant de bureau francophone qui pilote des fonctions autorisées du poste, gère des fichiers et des rappels, et peut utiliser un modèle d’IA local facultatif. Le serveur utilise Node.js 18+ et sa bibliothèque standard : **aucune dépendance npm, clé API ou compte cloud**. Sans Ollama, le NLU français et les actions usuelles continuent de fonctionner ; les réponses libres et les commandes multilingues nécessitent un modèle local installé.

## Démarrage

Prérequis : **Node.js 18 ou plus récent**.

```sh
npm start
```

Puis ouvre <http://localhost:3000>. Aucun `npm install` n’est requis. Pour lancer les tests :

```sh
npm test
```

Pour une preview ou un réseau local maîtrisé : `HOST=0.0.0.0 PORT=3000 npm start`. Sous Windows, utilise `Demarrer-NIKOUS.bat` ; le guide pas-à-pas est dans [`INSTALLER-SUR-WINDOWS.md`](INSTALLER-SUR-WINDOWS.md).

## Fonctions et exemples

| Besoin | Exemples en français |
| --- | --- |
| Fichiers | `liste les fichiers` · `lis notes.txt` · `crée fichier idées.txt avec quelques idées` · `cherche fichier contenant budget` · `renomme ancien.txt en nouveau.txt` |
| Poste | `état du système` · `ouvre Word` · `ferme Word` · `passe à Chrome` · `fais une capture d’écran` · `mets le volume à 50 %` · `mets la luminosité à 60 %` · `verrouille l’écran` |
| Web | `cherche sur le web les résultats du Bénin` — ouvre une recherche DuckDuckGo dans le navigateur par défaut |
| Contacts | `ajoute contact Papa +229…` · `dis à Papa que je suis en retard` — confirmation requise, puis ouverture d’un brouillon WhatsApp ; il faut encore cliquer sur **Envoyer** dans WhatsApp |
| Quotidien | `météo à Cotonou` · `calcule sqrt(81) + pi` · `note : appeler le médecin` · `heure à Europe/Paris` |
| Automatisations | `rappelle-moi dans 10 minutes de faire une pause` · `chaque lundi à 09:00 : état du système` · `crée routine matin : état du système ; liste des processus` |
| Voix | 🎙 conversation locale au premier plan · ◉ **VEILLE** pour l’agent local au mot d’activation « Nikous » |

Tu peux enchaîner jusqu’à six demandes avec **puis**. Le sélecteur de langue propose 22 langues ; les commandes non françaises et les réponses libres utilisent Ollama/Gemma si le modèle local est disponible. Sans modèle, NIKOUS conserve son NLU et ses commandes françaises, et signale ses limites.

## IA locale et fonctionnement hors ligne

L’IA est facultative et ne se connecte qu’à Ollama sur la boucle locale (`127.0.0.1`, `localhost` ou `::1`). Exemple d’installation initiale : installer Ollama, puis télécharger une fois le modèle Gemma choisi :

```sh
ollama pull gemma3:4b
```

Démarre Ollama et NIKOUS. Pour choisir un autre modèle, configure `NIKOUS_OLLAMA_MODEL`. Le téléchargement initial du logiciel/modèle nécessite Internet ; l’inférence et l’historique de conversation restent sur la machine. **NIKOUS ne bascule jamais vers un fournisseur d’IA distant.** En l’absence d’Ollama ou de modèle, son NLU intégré continue de répondre aux intentions qu’il reconnaît.

## Veille vocale locale (facultative)

Le bouton **VEILLE** est désactivé par défaut et demande une confirmation de confidentialité. Il écoute seulement après activation explicite, affiche son état dans le HUD et avertit avant la fermeture de l’onglet. Si tu choisis malgré tout de fermer le navigateur, il continue à tourner tant que le serveur NIKOUS reste lancé ; arrête-le dans l’interface ou ferme le serveur pour couper le micro. La reconnaissance est assurée par `whisper.cpp` et son modèle local ; aucun flux audio n’est envoyé vers un service cloud. Télécharge/compile whisper.cpp et un modèle multilingue compatibles avec `whisper-stream`, puis configure avant le lancement :

```sh
NIKOUS_WHISPER_STREAM=/chemin/vers/whisper-stream
NIKOUS_WHISPER_MODEL=/chemin/vers/ggml-small.bin
```

Sous Windows, définis ces variables d’environnement avec les chemins des exécutables et modèles Windows. Redémarre ensuite le serveur et choisis la langue souhaitée dans le HUD. Le moteur reste optionnel : si son exécutable ou son modèle manque, la veille ne démarre pas et l’interface explique la configuration à compléter. Le premier téléchargement du modèle nécessite Internet ; après installation, la reconnaissance est locale.

Le bouton 🎙 constitue un autre mode de conversation, dans le navigateur. Chrome récent peut demander une permission microphone et le téléchargement initial d’un pack vocal local pour la langue choisie ; NIKOUS refuse la reconnaissance distante. Pour la synthèse vocale, il utilise les voix installées du système (Windows/macOS/Linux).

## Actions système et limites par plateforme

Les applications exécutables sont limitées à une liste explicite. La fermeture d’application demande une confirmation ; les commandes destructrices globales restent bloquées. Captures, verrouillage, changement de fenêtre et contrôle média utilisent les outils natifs de la plateforme. Le réglage de luminosité dépend du matériel et de l’outil local disponible : Windows/Linux utilisent `WMI` ou `brightnessctl`/`xbacklight`, macOS nécessite l’outil local facultatif `brightness`. Les utilitaires absents ou périphériques incompatibles produisent une explication, sans repli distant.

Les fichiers sont bornés à la racine autorisée — `C:\Users` par défaut sous Windows, dossier personnel ailleurs. `NIKOUS_ROOT` permet de choisir cette racine. Les confirmations de commande sont à usage unique et expirent après deux minutes. Le mode accès complet élargit certaines autorisations, mais ne désactive jamais les blocages destructifs globaux.

## Réseau et confidentialité

Les notes, contacts, réglages, historique, rappels et routines sont stockés dans `data/`, ignoré par Git (`NIKOUS_DATA_DIR` permet de choisir un autre dossier). Ollama reste local et l’audio ne quitte pas le poste. Quelques fonctions sont explicitement réseau : météo/fuseaux via Open-Meteo, recherche web dans DuckDuckGo, ouverture de WhatsApp Web et téléchargement initial des modèles/voix. Une recherche transmet ses termes au moteur choisi ; la préparation WhatsApp transmet le numéro et le texte à WhatsApp uniquement lorsque tu confirmes l’ouverture du brouillon. NIKOUS **ne clique jamais sur Envoyer**. Le serveur HTTP n’a pas d’authentification : garde-le sur la machine ou un réseau de confiance.

## Structure

```text
server/              # Serveur HTTP natif, API, SSE, NLU, IA locale et agent vocal
server/actions/      # Fichiers, système, contacts, automatisations et utilitaires
public/              # Interface HTML/CSS/JS vanilla
 test/               # Tests node:test (32 tests)
data/                # Données locales ignorées par Git
scripts/             # Outils du kit Windows
```

Consulte [`INSTALLER-SUR-WINDOWS.md`](INSTALLER-SUR-WINDOWS.md) pour le démarrage, les raccourcis et le mode administrateur sous Windows.
