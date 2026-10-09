# Colonnes CRM pour Ads Manager

Les vrais chiffres de ton tracking, dans Meta Ads Manager et Google Ads.

L’extension lit un serveur que tu héberges : une instance
[Agence OS](https://github.com/impulsion-com/agence-os) (module Tracking OS), ou
tout serveur qui parle le même contrat `/api/ext/v1`.

Meta sait compter des clics et des formulaires. Il ne sait rien du rendez-vous
honoré, du contrat signé, ni de l’argent encaissé. Cette extension pose ces
chiffres-là à côté des siens, et permet de cliquer dessus pour voir **qui** se
cache derrière chaque ligne.

## Ce qu’elle affiche

La dépense, puis une colonne par étape de ton entonnoir (leads, rendez-vous,
ventes), le chiffre d’affaires attribué, le ROAS réel, le coût par lead et le
coût par vente.

La liste des colonnes vient du serveur : une étape ajoutée à l’entonnoir d’un
site apparaît ici sans mise à jour de l’extension.

## Ce qu’elle permet

- **Changer de modèle d’attribution** sans quitter Ads Manager, parmi ceux que
  le serveur annonce, et régler la fenêtre en jours.
- **Cliquer un chiffre** pour ouvrir la liste des personnes que la ligne a
  amenées : nom, étape la plus avancée, montant attribué, date, et un lien vers
  leur fiche.
- **Voir ce qu’elle ne sait pas.** Une ligne non identifiée n’affiche aucun
  chiffre. Une campagne que le serveur ne connaît pas le dit, ce qui n’est pas
  la même chose que « zéro lead ».

## Installation

1. `chrome://extensions`, activer le mode développeur.
2. « Charger l’extension non empaquetée », choisir ce dossier.
3. Ouvrir les réglages de l’extension, coller l’adresse de ton serveur et la clé
   d’API, puis « Tester la connexion ». Chrome demande alors l’accès à cette
   adresse, et à elle seule.
4. Autoriser Meta Ads Manager, puis Google Ads.

Avec Agence OS, la clé se crée dans Réglages > API et MCP > nouveau jeton
« Extension Chrome ». Elle est **en lecture seule**, n’ouvre que les chiffres
d’attribution, et se révoque d’un clic.

L’extension choisit le site suivi d’après le compte publicitaire ouvert dans la
page : ce compte doit être connecté dans Agence OS et rattaché au même client
que le site. Sur un compte qu’elle ne connaît pas, elle se tait.

## Ce qu’elle ne fera pas

**Trier ou filtrer le tableau de la régie par un de ses chiffres.** Il faudrait
faire re-rendre les lignes à la régie dans un ordre qu’on décide, ce qui n’est
pas à notre portée.

**Attribuer les impressions.** Le serveur attribue les clics, et assume que la
notoriété est sous-créditée. C’est un choix documenté, pas une limite technique.

## Confidentialité

L’extension parle à **un seul** serveur, celui dont tu as saisi l’adresse, et
uniquement en lecture. Elle n’envoie rien à personne d’autre, n’a aucun service
d’analyse, et ne lit le contenu des pages publicitaires que pour y reconnaître
des noms de campagnes et des identifiants.

La clé d’API vit dans `chrome.storage.local`, jamais dans `storage.sync` : elle
n’est donc pas synchronisée chez Google, ni recopiée sur les autres profils
Chrome. Elle ne descend jamais dans un onglet.

## Vérification

```bash
python3 scripts/verifier.py
node scripts/charger.js
```

Une cinquantaine de règles et l’assemblage des modules, sans aucune dépendance.

## Le contrat

Quatre routes en lecture seule, `ping`, `metrics`, `prospects` et `index`, sous
`/api/ext/v1/`. Elles sont décrites dans la documentation d’Agence OS
(`docs/tracking.md`, section « Extension Chrome »).

## État

| Régie | État |
| --- | --- |
| Meta Ads Manager | Vérifié sur écran réel. Les lignes sont reconnues par leur identifiant |
| Google Ads | Vérifié sur écran réel. Google n’expose aucun identifiant dans la page : les lignes sont reconnues par leur **nom**, et deux campagnes du même nom restent « non identifiées » |
| TikTok Ads | Écrit, jamais vérifié : aucun serveur ne synchronise encore TikTok |

Quand la page n’indique pas sa période dans son adresse, l’extension interroge
les 30 derniers jours et l’écrit dans sa barre (« période par défaut »).

## Licence

MIT.
