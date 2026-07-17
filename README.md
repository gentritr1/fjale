# FJALË

FJALË është një lojë e përditshme fjalësh në shqip. Aplikacioni është statik, pa varësi runtime dhe mund të përdoret si PWA.

## Çfarë përfshin

- 138 përgjigje të redaktuara me gjurmë, përkufizime, rrokje dhe shembuj; pool-i ditor v1 ruan 62 fjalët e para pa ndryshuar historinë.
- 14,257 prova të pranuara nga fjalori shqip, me nëntë dyshkronjëshat si shkronja të vetme.
- Fjalën e ditës, Arkivën për ditët e humbura, lojë pa fund dhe sfida me të njëjtën fjalë për miqtë.
- Gjurmën pas provës së tretë, mënyrën **Besa** pa ndihmë dhe Pasaportën e alfabetit.
- Statistika të ndara për Sot, Arkivë, Pa fund dhe Gjithsej; Arkiva nuk e prek serinë ditore.
- Vlerësim pas lojës dhe një rrugë të sjellshme për të raportuar një fjalë që mungon.
- Ndarje rezultati, pamje të errët, kontrast të lartë, tinguj opsionalë dhe lëvizje të reduktuara.
- Instalim PWA dhe lojë offline pas vizitës së parë.

## Kufizimet e beta-s

Vlerësimet dhe klikimet e raportimit ruhen vetëm në shfletues. Një raport i
mbërrin ekipit vetëm nëse lojtari dërgon email-in e paraplotësuar që hap lidhja.
Pool-i ditor mbetet 62 fjalë derisa të zbatohet skema e pandryshueshme e epokave;
rritja e numrit drejtpërdrejt do të ndryshonte fjalët historike.

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
- `og-fjale-v1.png` dhe burimi i tij SVG janë karta e versionuar për ndarje.
- `robots.txt` dhe `sitemap.xml` tregojnë origjinën kanonike për kërkuesit.
- `vercel.json` mban headers-at e sigurisë dhe politikën e cache-it në production.

## Kontratat e projektit

- [`LEXICON.md`](LEXICON.md) përcakton shtresat e fjalorit, shqyrtimin,
  identitetin e sfidave dhe epokat ditore.
- [`ROADMAP.md`](ROADMAP.md) ndan punën në Tani, Më pas dhe Më vonë, me kushtet
  e publikimit.
- [`PRODUCT.md`](PRODUCT.md) dhe [`DESIGN.md`](DESIGN.md) ruajnë premtimin e
  produktit dhe drejtimin vizual.

## PWA dhe përditësimet

Service worker-i përdor strategjinë **network first** për HTML/JS/CSS dhe
korpusin e provave të pranuara: kur ka internet i rivlerëson dhe rifreskon
cache-in; offline përdor kopjen e fundit të suksesshme. Ikonat (`favicon.svg`,
`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) përdorin **cache
first**, sepse nuk ndryshojnë pa ndryshuar URL-në, dhe kështu shmangen kërkesa
të panevojshme rrjeti. Rrugët e panjohura nuk zëvendësohen me `index.html`.

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
