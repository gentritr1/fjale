# FJALË

FJALË është një lojë e përditshme fjalësh në shqip. Aplikacioni është statik, pa varësi runtime dhe mund të përdoret si PWA.

## Çfarë përfshin

- 62 përgjigje të redaktuara me gjurmë, përkufizime, rrokje dhe shembuj; të 36 shkronjat mund të mblidhen.
- 14,257 prova të pranuara nga fjalori shqip, me nëntë dyshkronjëshat si shkronja të vetme.
- Fjalën e ditës, lojë pa fund dhe sfida me të njëjtën fjalë për miqtë.
- Gjurmën pas provës së tretë, mënyrën **Besa** pa ndihmë dhe Pasaportën e alfabetit.
- Statistika, seri ditore, ndarje rezultati, pamje të errët, kontrast të lartë, tinguj opsionalë dhe lëvizje të reduktuara.
- Instalim PWA dhe lojë offline pas vizitës së parë.

## Nisja lokale

Kërkohet Node.js 20 ose më i ri.

```sh
npm run dev
```

Pastaj hape [http://127.0.0.1:3000](http://127.0.0.1:3000). Porta dhe adresa mund të ndryshohen me variablat `PORT` dhe `HOST`, për shembull:

```sh
PORT=4173 HOST=0.0.0.0 npm run dev
```

## Kontrolli

```sh
npm test
npm run check
```

`npm run check` kontrollon sintaksën e serverit dhe service worker-it, pastaj ekzekuton testet e Node-it.

## Struktura

- `server.mjs` shërben vetëm skedarë brenda projektit, me MIME types dhe headers sigurie. Vetëm `/` kalon te `index.html`; rrugët dhe skedarët e panjohur kthejnë `404`.
- `manifest.webmanifest` përmban emrin, gjuhën, ngjyrat dhe ikonat e instalimit.
- `service-worker.js` ruan shell-in lokal për përdorim offline.
- `favicon.svg` është ikona e faqes dhe e PWA-së.

## PWA dhe përditësimet

Service worker-i përdor strategjinë **network first** për HTML/JS/CSS: kur ka internet merr gjithmonë versionin e fundit dhe rifreskon cache-in; offline përdor kopjen e fundit të suksesshme. Ikonat (`favicon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) përdorin **cache first**, sepse nuk ndryshojnë pa ndryshuar URL-në, dhe kështu shmangen kërkesa të panevojshme rrjeti. Rrugët e panjohura nuk zëvendësohen me `index.html`.

Aplikacioni e regjistron worker-in nga kodi i klientit:

```js
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js");
  });
}
```

Lista e shell-it gjendet te `APP_SHELL` në `service-worker.js`. Kur ndryshon vetë strategjia ose dëshiron të heqësh përfundimisht hyrje të vjetra, ndrysho edhe `CACHE_NAME`. URL-të absolute presupozojnë se aplikacioni hostohet në rrënjën e domain-it.

Serveri i përfshirë është i përshtatshëm për zhvillim dhe preview lokal. Për publikim production përdor një host me HTTPS, compression dhe menaxhim të certifikatave.

## Fjalori dhe licenca

Lista e provave të pranuara gjenerohet nga fjalori shqip MySpell/Hunspell i
LibreOffice. Burimi i saktë, checksum-i dhe skripti i riprodhueshëm përfshihen
në projekt; hollësitë janë te `THIRD_PARTY_NOTICES.md`.

Copyright (C) 2026 FJALË contributors. Ky projekt shpërndahet nën
`GPL-2.0-or-later`; teksti i plotë gjendet te `LICENSE`. Programi jepet pa
asnjë garanci, brenda kufijve të lejuar nga ligji.
