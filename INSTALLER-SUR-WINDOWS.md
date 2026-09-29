# Installer et utiliser NIKOUS sous Windows

Ce guide est pensé pour une installation personnelle. **Node.js 18 ou plus récent** est le seul prérequis pour le cœur de NIKOUS ; Ollama/Gemma et whisper.cpp sont des options locales séparées pour l’IA libre et la veille au mot d’activation. Aucun compte ou clé API n’est nécessaire. NIKOUS n’inclut pas les programmes ni les modèles externes.

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

Double-clique sur **Demarrer-NIKOUS.bat**. Une fenêtre de démarrage réduite se lance, puis NIKOUS s’ouvre dans le navigateur à `http://127.0.0.1:3000`.

Laisse le serveur tourner pendant que tu utilises l’assistant. Pour fermer NIKOUS, double-clique sur **Arreter-NIKOUS.bat**. Le serveur reste uniquement sur le PC : il n’est pas publié sur Internet.

### Créer un raccourci sur le Bureau et lancer au démarrage

Double-clique sur **Creer-raccourci-bureau.bat**. Pour un démarrage automatique facultatif : appuie sur `Windows + R`, tape `shell:startup`, valide, puis copie le raccourci dans ce dossier. Retire-le à tout moment pour désactiver le démarrage automatique. Ce lancement garde le serveur et l’agent local actifs dans la session Windows.

## 4. Utiliser NIKOUS et le contrôle du poste

Écris comme dans une conversation. Quelques exemples :

- `liste les fichiers` · `lis compte-rendu.txt` · `crée fichier idées.txt avec appeler le garage demain`
- `état du système` · `quelle heure est-il` · `ouvre le dossier Documents` · `ouvre Word`
- `ferme Word` (confirmation demandée) · `passe à Chrome`
- `fais une capture d’écran` · `mets le volume à 50 %` · `mets la luminosité à 60 %` · `verrouille l’écran`
- `cherche sur le web actualité à Cotonou` (ouvre DuckDuckGo dans le navigateur par défaut)
- `ajoute contact Papa +229…` puis `dis à Papa que je suis en retard`
- `calcule sqrt(81) + pi` · `note : acheter du café` · `rappelle-moi dans 20 minutes de faire une pause`
- `météo à Cotonou` · `aide`

La luminosité Windows dépend du matériel : le réglage natif WMI fonctionne surtout avec l’écran intégré d’un portable, pas nécessairement avec un moniteur externe. Les commandes de capture et certaines fonctions sont également soumises aux autorisations Windows.

Les contacts et numéros sont enregistrés dans `data/contacts.json` sur ce PC. NIKOUS demande une confirmation avant d’ouvrir le composeur WhatsApp prérempli dans le navigateur. **Le texte et le numéro sont alors transmis à WhatsApp ; NIKOUS ne clique pas sur Envoyer.** Vérifie le brouillon et envoie-le toi-même.

Par défaut, les fichiers et chemins sont limités au dossier de ton profil Windows (`C:\Users`). Les chemins extérieurs sont refusés en mode sûr.

## 5. Choisir une langue et installer l’IA locale (optionnel)

Le menu de langue propose 22 langues. Pour les commandes non françaises et les réponses libres, NIKOUS peut utiliser Ollama et un modèle Gemma exclusivement sur ce PC. Sans modèle installé, le NLU français et les commandes habituelles restent disponibles ; aucune IA distante ne prend le relais.

1. Installe Ollama depuis <https://ollama.com/download/windows>.
2. Dans PowerShell, télécharge une fois le modèle :

   ```powershell
   ollama pull gemma3:4b
   ```

3. Laisse Ollama démarré, puis lance NIKOUS. Le HUD indique si l’IA locale est disponible. Le téléchargement initial nécessite Internet et de l’espace disque ; la génération elle-même reste locale. Les performances dépendent de la mémoire et du processeur de ton ordinateur.

Ollama est facultatif : NIKOUS ne l’installe pas automatiquement et ne contacte aucun autre serveur d’IA. Les conversations locales sont stockées dans le dossier `data`.

## 6. Conversation vocale et veille au mot « Nikous »

### Bouton 🎙 dans le navigateur

Le bouton 🎙 démarre une conversation au premier plan : parle, NIKOUS transcrit localement, répond, puis se remet à l’écoute. Chrome récent est recommandé. Il peut demander l’autorisation du microphone et télécharger une fois le pack de langue locale choisi. Si la reconnaissance sur l’appareil n’est pas disponible, NIKOUS ne bascule pas vers le cloud. La synthèse vocale utilise les voix locales installées dans Windows.

### Agent de veille whisper.cpp

Le bouton **◉ VEILLE** est désactivé par défaut. Son activation demande une confirmation visible : après opt-in, le microphone reste actif et l’audio est traité localement par whisper.cpp. L’agent continue tant que le serveur NIKOUS fonctionne, même si tu fermes l’onglet ; le navigateur t’avertit avant sa fermeture pour éviter un arrêt accidentel de l’indicateur. Si tu confirmes la fermeture, rouvre `http://127.0.0.1:3000` pour retrouver le bouton **VEILLE**, ou arrête immédiatement le serveur avec **Arreter-NIKOUS.bat**. Ne l’active pas si tu ne souhaites pas une écoute persistante.

Pour l’installer, récupère/compile une version Windows de whisper.cpp qui fournit `whisper-stream.exe` et télécharge un modèle **multilingue** compatible, par exemple `ggml-small.bin`. Puis ajoute ces deux variables dans les **variables d’environnement utilisateur Windows** (recherche « Modifier les variables d’environnement de votre compte ») :

- `NIKOUS_WHISPER_STREAM` — chemin complet vers `whisper-stream.exe` ;
- `NIKOUS_WHISPER_MODEL` — chemin complet vers le fichier modèle `.bin`.

Exemple de chemins :

```text
NIKOUS_WHISPER_STREAM=C:\Outils\whisper.cpp\build\bin\whisper-stream.exe
NIKOUS_WHISPER_MODEL=C:\Modeles\ggml-small.bin
```

Ferme puis relance NIKOUS pour prendre en compte les variables. Le téléchargement du programme/modèle est initial ; après configuration, la reconnaissance tourne localement et prend en charge les langues de whisper.cpp. Le modèle peut consommer plusieurs gigaoctets de mémoire et de disque. Si la veille ne démarre pas, vérifie les chemins et que le modèle est bien présent. L’indicateur du HUD montre l’état de l’agent.

## 7. Mode administrateur — contrôle étendu

Le mode administrateur élargit la racine de fichiers à `C:\` et active l’accès complet aux commandes qui ne sont pas globalement bloquées. Utilise-le uniquement si tu comprends les conséquences et fais confiance à cette installation.

1. Ferme une éventuelle instance avec **Arreter-NIKOUS.bat**.
2. Fais un clic droit sur **Demarrer-NIKOUS-Admin.bat** et choisis **Exécuter en tant qu’administrateur**.
3. Valide la fenêtre de contrôle de compte d’utilisateur (UAC).

Même en mode complet, les commandes de destruction globale connues (formatage, suppression récursive d’une racine, arrêt système, etc.) restent interdites. Les confirmations requises par les actions sensibles restent actives.

## 8. Réseau et confidentialité

L’IA Ollama, le traitement du microphone whisper.cpp, les notes et les contacts sont locaux. Certaines actions demandent explicitement Internet : météo/fuseaux via Open-Meteo, recherche web (les termes sont transmis au moteur DuckDuckGo), ouverture du brouillon WhatsApp après confirmation, et téléchargement initial des logiciels, voix ou modèles locaux. Le numéro et le texte WhatsApp ne sont transmis qu’au moment où tu confirmes l’ouverture du composeur.

## 9. Dépannage

- **Le navigateur ne s’ouvre pas** : vérifie que `http://127.0.0.1:3000` répond et que la fenêtre NIKOUS n’a pas été fermée.
- **Le port 3000 est déjà utilisé** : arrête l’autre serveur ou NIKOUS avec `Arreter-NIKOUS.bat`, puis relance-le.
- **« Node.js 18+ est requis »** : installe ou mets à jour la version LTS depuis <https://nodejs.org/> puis ouvre une nouvelle session.
- **Un fichier n’est pas trouvé** : vérifie son nom et son emplacement sous `C:\Users`. Les chemins extérieurs sont bloqués en mode sûr.
- **Le HUD indique que Gemma est indisponible** : démarre Ollama et vérifie que `ollama list` affiche le modèle `gemma3:4b`. Les commandes françaises reconnues fonctionnent toujours sans lui.
- **La veille ne démarre pas** : confirme d’abord whisper.cpp et le modèle multilingue, puis vérifie les deux variables d’environnement et redémarre le serveur. Les exécutables et modèles ne sont pas fournis avec NIKOUS.
- **Le micro du navigateur est bloqué** : autorise-le dans les réglages du site via le cadenas près de l’adresse ; dans un aperçu intégré, ouvre la page dans un nouvel onglet.
- **La météo ou la recherche web échoue** : vérifie Internet. Ces fonctions utilisent des services externes ; les actions locales continuent de fonctionner hors ligne.

## 10. Mettre à jour sans perdre les données

1. Arrête le serveur avec **Arreter-NIKOUS.bat**.
2. Décompresse la nouvelle version dans un nouveau dossier.
3. Copie le dossier `data` de l’ancienne version vers la nouvelle pour conserver réglages, contacts, notes, rappels et historique.
4. Relance **Demarrer-NIKOUS.bat**.

Ne partage pas le dossier `data` si tu ne veux pas partager tes notes, contacts et historique. Il est volontairement ignoré par Git.
