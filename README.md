# FJALË

FJALË është një lojë e përditshme fjalësh në shqip. Aplikacioni është statik, pa varësi runtime dhe mund të përdoret si PWA.

## Çfarë përfshin

- 138 përgjigje të redaktuara me gjurmë, përkufizime, rrokje dhe shembuj; epoka e nisjes ruan 62 fjalët e para, ndërsa epoka e 23 korrikut i planifikon të 138-at pa ndryshuar historinë.
- 21,481 prova të pranuara nga fjalori shqip, tani edhe me trajtat e lakuara e të zgjedhuara që deklaron Hunspell-i, me nëntë dyshkronjëshat si shkronja të vetme.
- Fjalën e ditës, Arkivën për ditët e humbura, lojë pa fund dhe sfida me të njëjtën fjalë për miqtë.
- Gjurmën pas provës së tretë, e cila zbulon kuptimin pa shkronja dhe përdor një provë; mënyrën **Besa** pa ndihmë; dhe Pasaportën e alfabetit.
- Statistika të ndara për Sot, Arkivë, Pa fund dhe Gjithsej; Arkiva nuk e prek serinë ditore.
- Vlerësim pas lojës dhe një rrugë të sjellshme për të raportuar një fjalë që mungon.
- Ndarje rezultati, pamje të errët, kontrast të lartë, tinguj opsionalë dhe lëvizje të reduktuara.
- Instalim PWA dhe lojë offline pas vizitës së parë.

## Kufizimet e beta-s

Vlerësimet dhe klikimet e raportimit ruhen vetëm në shfletues. Një raport i
mbërrin ekipit vetëm nëse lojtari dërgon email-in e paraplotësuar që hap lidhja.
Epoka e nisjes mbetet e ngrirë me 62 fjalë deri më 22 korrik 2026; nga 23
korriku epoka e dytë përdor të 138 përgjigjet e miratuara. Çdo përgjigje ka një
ID të pandryshueshme, kodet e sfidave dhe fjala e ditës zgjidhen sipas ID-së,
dhe çdo rritje e ardhshme bëhet vetëm me një epokë të re e me listë të ngrirë
ID-sh. Kjo lejon të anashkalohen fjalët e refuzuara pa prekur historinë ose
lidhjet e vjetra.

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

## Redaksia lokale

Grupi i fjalëve në pritje mund të shqyrtohet në një mjet lokal në shfletues:

```sh
npm run editorial
```

Hap `http://127.0.0.1:4317/admin`. Rishikimet ruhen si JSON të ndara për çdo
shqyrtues; mjeti nuk publikohet dhe nuk ndryshon vetë fjalorin ose epokat.
Rrjedha e plotë, bashkërendimi dhe propozimi i epokës dokumentohen te
[`EDITORIAL.md`](EDITORIAL.md).

## Struktura

- `server.mjs` shërben vetëm skedarë brenda projektit, me MIME types dhe headers sigurie. Vetëm `/` kalon te `index.html`; rrugët dhe skedarët e panjohur kthejnë `404`.
- `manifest.webmanifest` përmban emrin, gjuhën, ngjyrat dhe ikonat e instalimit.
- `service-worker.js` ruan shell-in lokal për përdorim offline.
- `favicon.svg` është ikona e faqes dhe e PWA-së.
- `og-fjale-v3.png` dhe burimi i tij SVG janë karta aktive e versionuar për ndarje; versionet e mëparshme ruhen për lidhjet e cache-uara.
- `robots.txt` dhe `sitemap.xml` tregojnë origjinën kanonike për kërkuesit.
- `vercel.json` mban headers-at e sigurisë dhe politikën e cache-it në production.

## Kontratat e projektit

- [`LEXICON.md`](LEXICON.md) përcakton shtresat e fjalorit, shqyrtimin,
  identitetin e sfidave dhe epokat ditore.
- [`ROADMAP.md`](ROADMAP.md) ndan punën në Tani, Më pas dhe Më vonë, me kushtet
  e publikimit.
- [`EDITORIAL.md`](EDITORIAL.md) përshkruan rregullin me dy shqyrtues,
  përjashtimin e vetëm të dokumentuar për grupin e korrikut dhe propozimin e
  sigurt të epokave.
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

Lista e shell-it gjendet te `APP_SHELL` në `service-worker.js`. **Rregull
publikimi:** çdo release që ndryshon një skedar të kësaj liste duhet të rrisë
numrin e `CACHE_NAME`, që klientët ekzistues të marrin njoftimin `Rifresko` dhe
një cache të re. `npm run check` e verifikon kundrejt worktree-t ose commit-it
paraardhës; CI e përsërit kundrejt commit-it bazë të push-it/PR-së. Një ndryshim
runtime nuk është gati për publikim kur ky kontroll dështon. URL-të absolute
presupozojnë se aplikacioni hostohet në rrënjën e domain-it.

Serveri i përfshirë është i përshtatshëm për zhvillim dhe preview lokal. Për publikim production përdor një host me HTTPS, compression dhe menaxhim të certifikatave.

## Fjalori dhe licenca

Lista e provave të pranuara gjenerohet nga fjalori shqip MySpell/Hunspell i
LibreOffice. Skripti zgjeron në mënyrë të riprodhueshme trajtat që deklarojnë
rregullat e ndajshtesave (`sq_AL.aff`) — zgjerim i trajtave të deklaruara, jo
paradigma të plota. Burimi i saktë, checksum-et (`.dic` dhe `.aff`) dhe skripti
përfshihen në projekt; hollësitë janë te `THIRD_PARTY_NOTICES.md`.

Copyright (C) 2026 FJALË contributors. Ky projekt shpërndahet nën
`GPL-2.0-or-later`; teksti i plotë gjendet te `LICENSE`. Programi jepet pa
asnjë garanci, brenda kufijve të lejuar nga ligji.
