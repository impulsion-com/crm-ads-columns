// Le banc de test : piloter le Chrome de developpement par le protocole CDP.
//
//   node scripts/banc.mjs targets
//   node scripts/banc.mjs open "https://adsmanager.facebook.com/..."
//   node scripts/banc.mjs eval "<expression JS>"          (page active, monde MAIN)
//   node scripts/banc.mjs eval-fichier chemin.js          (idem, depuis un fichier)
//
// POURQUOI CE FICHIER EXISTE. Ads Manager n est observable qu avec une session
// connectee : impossible de developper les selecteurs a l aveugle. Le banc est
// un Chrome separe (profil dedie, par exemple ~/.cache/banc-chrome, lance
// avec --remote-debugging-port=9333) dans lequel on peut ENFIN regarder le DOM
// reel, essayer un selecteur, et verifier l extension de bout en bout.
//
// Node 22 fournit WebSocket en global : aucune dependance.

import fs from "node:fs";

const PORT = process.env.BANC_PORT || 9333;

async function json(chemin, methode) {
  const r = await fetch(`http://localhost:${PORT}${chemin}`, { method: methode || "GET" });
  return r.json();
}

function attendre(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pageActive() {
  const cibles = await json("/json/list");
  const pages = cibles.filter((c) => c.type === "page" && !c.url.startsWith("devtools"));
  // La page la plus utile : Ads Manager d abord, sinon la premiere.
  return pages.find((p) => /adsmanager|ads\.google|ads\.tiktok/.test(p.url)) || pages[0];
}

function surSocket(ws) {
  let id = 0;
  const attentes = new Map();
  ws.addEventListener("message", (ev) => {
    const d = JSON.parse(ev.data);
    if (d.id && attentes.has(d.id)) {
      attentes.get(d.id)(d);
      attentes.delete(d.id);
    }
  });
  return function envoyer(methode, params) {
    return new Promise((resoudre, rejeter) => {
      const mid = ++id;
      attentes.set(mid, (d) => (d.error ? rejeter(new Error(JSON.stringify(d.error))) : resoudre(d.result)));
      ws.send(JSON.stringify({ id: mid, method: methode, params: params || {} }));
      setTimeout(() => {
        if (attentes.has(mid)) {
          attentes.delete(mid);
          rejeter(new Error("delai depasse : " + methode));
        }
      }, 30000);
    });
  };
}

async function evaluer(expression) {
  const page = await pageActive();
  if (!page) throw new Error("aucune page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r);
    ws.addEventListener("error", j);
  });
  const envoyer = surSocket(ws);
  const r = await envoyer("Runtime.evaluate", {
    expression: expression,
    returnByValue: true,
    awaitPromise: true,
    // allowUnsafeEvalBlockedByCSP n existe pas : si la CSP de la page bloque
    // eval, passer par des expressions sans eval (c est notre cas).
  });
  ws.close();
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  }
  return r.result.value;
}

async function principal() {
  const [commande, argument] = process.argv.slice(2);

  if (commande === "targets") {
    const cibles = await json("/json/list");
    for (const c of cibles) {
      console.log(`${c.type.padEnd(15)} ${(c.title || "").slice(0, 50).padEnd(52)} ${c.url.slice(0, 90)}`);
    }
    return;
  }

  if (commande === "open") {
    const r = await json("/json/new?" + encodeURIComponent(argument), "PUT");
    console.log("ouvert :", r.id, r.url);
    return;
  }

  if (commande === "eval" || commande === "eval-fichier") {
    const code = commande === "eval" ? argument : fs.readFileSync(argument, "utf8");
    const v = await evaluer(code);
    console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
    return;
  }

  console.log("commandes : targets | open <url> | eval <js> | eval-fichier <chemin>");
}

principal().catch((e) => {
  console.error("ECHEC :", e.message);
  process.exit(1);
});
