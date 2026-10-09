// Simule le chargement des modules dans l ORDRE REEL, hors navigateur.
//
//   node scripts/charger.js
//
// POURQUOI CE SCRIPT EXISTE. `node --check` verifie la syntaxe, pas
// l assemblage. Une faute de frappe dans un nom de global
// (`IMPULSION_LIGNES` contre `IMPULSION_LIGNE`) passe la syntaxe, passe la
// relecture, et ne se voit qu au chargement dans Chrome, sur une page ou l on
// ne peut pas mettre de point d arret facilement.
//
// Ici, chaque module est evalue dans un faux navigateur, dans l ordre exact
// qu emploie le service worker, et l on verifie qu il pose bien le global que
// les suivants attendent.
//
// Ce n est PAS un test de comportement : rien n est appele. C est un test
// d assemblage, et c est deja beaucoup.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RACINE = path.resolve(__dirname, "..");
let echecs = 0;

function verifie(intitule, condition, detail) {
  if (condition) {
    console.log("  ok    " + intitule);
  } else {
    console.log("  ECHEC " + intitule + (detail ? " -> " + detail : ""));
    echecs += 1;
  }
}

/** Un faux navigateur, juste assez pour que les modules se posent. */
function faireContexte() {
  const inerte = function () {
    return inerte;
  };
  const element = {
    style: { cssText: "" },
    setAttribute: inerte,
    getAttribute: () => null,
    removeAttribute: inerte,
    appendChild: inerte,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: inerte,
    attachShadow: () => ({ appendChild: inerte }),
    classList: { add: inerte },
    closest: () => null
  };

  const fenetre = {
    location: { href: "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1" },
    document: {
      readyState: "complete",
      body: element,
      documentElement: element,
      createElement: () => Object.assign({}, element),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: inerte,
      hidden: false
    },
    addEventListener: inerte,
    postMessage: inerte,
    history: { pushState: inerte, replaceState: inerte },
    requestAnimationFrame: inerte,
    setTimeout: inerte,
    setInterval: inerte,
    clearInterval: inerte,
    clearTimeout: inerte,
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ overflowY: "visible" }),
    fetch: () => Promise.resolve({ text: () => Promise.resolve("") }),
    XMLHttpRequest: function () {},
    MutationObserver: function () {
      return { observe: inerte, disconnect: inerte };
    },
    ResizeObserver: function () {
      return { observe: inerte };
    },
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    console: { log: inerte, warn: inerte, error: inerte, table: inerte },
    Intl,
    Map,
    Set,
    Promise,
    JSON,
    Math,
    Date,
    Number,
    String,
    Array,
    Object,
    URLSearchParams,
    chrome: {
      runtime: {
        getURL: (p) => "chrome-extension://x/" + p,
        sendMessage: inerte,
        lastError: null,
        getManifest: () => ({ version: "0.1.0" })
      },
      storage: {
        local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
        session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
        onChanged: { addListener: inerte }
      },
      action: { setBadgeText: inerte, setBadgeBackgroundColor: inerte }
    }
  };
  fenetre.window = fenetre;
  fenetre.self = fenetre;
  fenetre.XMLHttpRequest.prototype = { open: inerte, send: inerte };
  return vm.createContext(fenetre);
}

function charger(contexte, chemin) {
  const code = fs.readFileSync(path.join(RACINE, chemin), "utf8");
  vm.runInContext(code, contexte, { filename: chemin });
}

// L ordre du service worker, recopie a la main pour que ce script echoue si
// quelqu un change l un sans l autre.
const COMMUNS = [
  "shared/journal.js",
  "shared/format.js",
  "shared/palette.js",
  "shared/icons.js"
];
const ISOLE = [
  "content/pont.js",
  "content/lignes.js",
  "content/panneau.js",
  "content/rendu-natif.js",
  "content/entete.js",
  "content/tiroir.js",
  "content/diagnostic.js",
  "content/orchestrateur.js"
];

console.log("\nChargement des modules, dans l ordre reel\n");

// ── Le monde isole, pour chaque plateforme ──────────────────────────────────
const URLS = {
  meta: "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1&date=2026-08-01_2026-08-24",
  google: "https://ads.google.com/aw/campaigns?ocid=1111111111&__c=2222222222&__e=1234567890",
  tiktok: "https://ads.tiktok.com/i18n/perf/campaign?aadvid=123"
};

for (const cle of Object.keys(URLS)) {
  console.log("Monde isole, " + cle);
  const ctx = faireContexte();
  ctx.location.href = URLS[cle];
  ctx.document.location = ctx.location;
  let erreur = null;
  try {
    for (const f of COMMUNS) charger(ctx, f);
    charger(ctx, "plateformes/" + cle + ".js");
    charger(ctx, "plateformes/registre.js");
    for (const f of ISOLE) charger(ctx, f);
  } catch (e) {
    erreur = e;
  }
  verifie(cle + " : tous les modules s evaluent", !erreur, erreur && erreur.message);
  if (erreur) continue;

  for (const global of [
    "IMPULSION_JOURNAL",
    "IMPULSION_FORMAT",
    "IMPULSION_PALETTE",
    "IMPULSION_ICONES",
    "IMPULSION_REGISTRE",
    "IMPULSION_PONT",
    "IMPULSION_LIGNES",
    "IMPULSION_PANNEAU",
    "IMPULSION_RENDU_NATIF",
    "IMPULSION_ENTETE",
    "IMPULSION_TIROIR",
    "IMPULSION_DIAGNOSTIC"
  ]) {
    verifie(cle + " : " + global + " est pose", Boolean(ctx[global]));
  }

  const adaptateur = ctx.IMPULSION_REGISTRE.pour(URLS[cle]);
  verifie(cle + " : le registre reconnait son URL", Boolean(adaptateur));
  if (adaptateur) {
    verifie(
      cle + " : le niveau se lit dans l URL",
      adaptateur.niveau(URLS[cle]) === "campagne",
      String(adaptateur.niveau(URLS[cle]))
    );
    verifie(cle + " : le compte se lit dans l URL", Boolean(adaptateur.compte(URLS[cle])));
  }
  if (cle === "google" && adaptateur) {
    // `__c` et `ocid` sont des identifiants internes de Google : seul `__e` porte le numero client.
    verifie("google : `__e` est le numero client, `__c` et `ocid` ne le sont pas", adaptateur.compte("https://ads.google.com/aw/campaigns?ocid=8591644319&__c=8176372415&__e=8791858341") === "8791858341" && adaptateur.compte("https://ads.google.com/aw/campaigns?ocid=8591644319&__c=8176372415") === null);
  }
}

// ── Le monde MAIN ───────────────────────────────────────────────────────────
console.log("\nMonde MAIN (interception)");
for (const cle of Object.keys(URLS)) {
  const ctx = faireContexte();
  ctx.location.href = URLS[cle];
  let erreur = null;
  try {
    charger(ctx, "plateformes/" + cle + ".js");
    charger(ctx, "plateformes/registre.js");
    charger(ctx, "content/reseau.js");
  } catch (e) {
    erreur = e;
  }
  verifie(cle + " : reseau.js s installe sans le monde isole", !erreur, erreur && erreur.message);
  if (!erreur) {
    verifie(cle + " : fetch a bien ete enveloppe", ctx.window.__IMPULSION_RESEAU__ === true);
  }
}

// ── Le service worker ───────────────────────────────────────────────────────
//
// C est le point d entree, et il appelle `reconcilier()` a l evaluation. Une
// erreur ici ne se voit que dans la page chrome://extensions, en petit.
console.log("\nService worker");
{
  const ctx = faireContexte();
  const inerte = () => inerte;
  ctx.importScripts = function () {
    for (const brut of arguments) {
      // Les chemins du service worker sont relatifs a background/.
      charger(ctx, path.normalize(path.join("background", brut)));
    }
  };
  ctx.chrome.scripting = {
    registerContentScripts: () => Promise.resolve(),
    unregisterContentScripts: () => Promise.resolve(),
    getRegisteredContentScripts: () => Promise.resolve([])
  };
  ctx.chrome.permissions = {
    contains: () => Promise.resolve(false),
    onAdded: { addListener: inerte },
    onRemoved: { addListener: inerte }
  };
  ctx.chrome.runtime.onStartup = { addListener: inerte };
  ctx.chrome.runtime.onInstalled = { addListener: inerte };
  ctx.chrome.runtime.onMessage = { addListener: inerte };

  let erreur = null;
  try {
    charger(ctx, "background/service-worker.js");
  } catch (e) {
    erreur = e;
  }
  verifie("le service worker s evalue", !erreur, erreur && erreur.message);
  if (!erreur) {
    verifie("il pose le client d API", Boolean(ctx.IMPULSION_API));
    verifie("il pose le cache", Boolean(ctx.IMPULSION_CACHE));
    verifie("il pose les reglages", Boolean(ctx.IMPULSION_REGLAGES));
  }
}

// ── Quelques fonctions pures, la ou une erreur serait invisible ─────────────
console.log("\nFonctions pures");
{
  const ctx = faireContexte();
  charger(ctx, "shared/format.js");
  const F = ctx.IMPULSION_FORMAT;
  verifie("un CAC indefini rend un tiret et jamais zero", F.euros(null) === F.VIDE);
  verifie("un ROAS s ecrit en multiple", F.multiple(5.6) === "5,6x", F.multiple(5.6));
  verifie(
    "un CPC sous dix euros garde ses centimes",
    F.euros(0.79).indexOf("79") !== -1,
    F.euros(0.79)
  );
  verifie(
    "un poids d attribution fractionnaire n est pas arrondi a zero",
    F.nombre(0.4) === "0,4",
    F.nombre(0.4)
  );
  verifie(
    "les marques de direction invisibles de Meta sont retirees du nom",
    F.normaliserNom("‪DMB | Froid‬") === "dmb | froid",
    JSON.stringify(F.normaliserNom("‪DMB | Froid‬"))
  );

  charger(ctx, "plateformes/meta.js");
  const M = ctx.IMPULSION_META;
  verifie(
    "Meta : la periode se lit dans l URL",
    JSON.stringify(M.periode("x?date=2026-08-01_2026-08-24")) ===
      JSON.stringify({ du: "2026-08-01", au: "2026-08-24", source: "url" })
  );
  verifie(
    "Meta : un identifiant Relay en base64 se ramene a son nombre",
    M.normaliserId(Buffer.from("AdCampaignGroup:120248921070630298").toString("base64")) ===
      "120248921070630298"
  );
  verifie(
    "Meta : AdCampaignGroup est une CAMPAGNE, AdCampaign est un ADSET",
    M.reseau.estEntite({ __typename: "AdCampaignGroup", id: "1", name: "a" }).niveau ===
      "campagne" &&
      M.reseau.estEntite({ __typename: "AdCampaign", id: "2", name: "b" }).niveau === "adset"
  );
  verifie(
    "Meta : un objet sans nom n est pas une entite",
    M.reseau.estEntite({ __typename: "Ad", id: "3" }) === null
  );

  charger(ctx, "plateformes/google.js");
  const G = ctx.IMPULSION_GOOGLE;
  const plage = G.lirePlageFrancaise("1 août 2026 - 24 août 2026");
  verifie(
    "Google : une plage de dates en francais se lit",
    plage && plage.du === "2026-08-01" && plage.au === "2026-08-24",
    JSON.stringify(plage)
  );
  verifie(
    "Google : un libelle inconnu rend null plutot que de deviner",
    G.lirePlageFrancaise("30 derniers jours") === null
  );
}

console.log("\n" + (echecs === 0 ? "Assemblage correct." : echecs + " echec(s).") + "\n");
process.exit(echecs === 0 ? 0 : 1);
