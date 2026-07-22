# Redaksia lokale

FJALË ka një mjet redaksional vetëm për zhvillim. Ai hapet në shfletues, por
nuk publikohet në Vercel dhe nuk mund të ndryshojë vetë fjalorin, epokat ose
historinë e lojës.

## Hapja

Kërkohet Node.js 20 ose më i ri.

```sh
npm run editorial
```

Pastaj hap `http://127.0.0.1:4317/admin`. Nëse porta është e zënë:

```sh
EDITORIAL_PORT=4318 npm run editorial
```

Serveri lidhet gjithmonë vetëm me `127.0.0.1`. `/admin`, skedarët e redaksisë
dhe API-ja e ruajtjes nuk ekzistojnë në publikim.

## Rrjedha e rishikimit

1. Secili shqyrtues përdor identifikuesin e vet me 2–32 shkronja të vogla,
   numra, `_` ose `-`.
2. Lloji, rrokjet, gjurma, përkufizimi, shembulli dhe regjistri mund të
   korrigjohen para vendimit. Fjala dhe ID-ja janë identitete të
   pandryshueshme; një fjalë e shkruar gabim refuzohet dhe zëvendësimi merr ID
   të re.
3. Vendimet janë `Prano për ditore`, `Vetëm për praktikë`, `Ka nevojë për
   korrigjim` dhe `Refuzo përmbajtjen`. Çdo vendim përveç pranimit kërkon arsye.
4. Ndryshimet ruhen si skicë në shfletues dhe, kur janë të vlefshme, në një
   skedar të veçantë për shqyrtuesin. Një skicë e pavlefshme shënohet te filtri
   `Vëmendje` dhe mbetet lokalisht pa bllokuar vendimet e tjera. Rrëshqitja është
   vetëm shkurtore me prekje; butonat dhe tastiera mbeten mënyra kryesore.
5. Shqyrtuesi i dytë punon në skedarin e vet. Vendimi i të parit nuk i shfaqet
   si përgjigje për t'u kopjuar; para përfundimit, ndërfaqja shfaq vetëm
   mbulimin. Rezultatet e përmbledhura shfaqen pasi të gjithë shqyrtuesit kanë
   mbaruar, ndërsa hollësitë bashkohen vetëm nga komanda CLI.

Grupi i ngrirë i përfunduar i korrikut është
`editorial/batches/answers-2026-07-62-137-v1.json`. Ai përmban hash-in e gjithë
grupit dhe një SHA-256 për secilën fjalë. Një ndryshim i burimit e bën
rishikimin e vjetër të papërshtatshëm në vend që ta zbatojë mbi tekst tjetër.

Rishikimet ruhen te:

```text
editorial/reviews/answers-2026-07-62-137-v1/reviewer-<id>.json
```

Rishikimet e papërpunuara, vendimet e bashkërenduara, kopjet rezervë dhe
propozimet e gjeneruara të epokave janë artefakte private lokale dhe
anashkalohen nga Git. Grupi i ngrirë nën `editorial/batches/` mbetet i
versionuar, që dy shqyrtues të punojnë gjithmonë mbi të njëjtin burim.

Ruajtja në disk është atomike dhe pranon vetëm skemën, grupin dhe rrugën e
paracaktuar. Butoni `Shkarko JSON` jep një kopje rezervë të lexueshme që
përfshin edhe skicat e pavlefshme, vetëm lokale. Numërimi 76/76 arrihet vetëm
kur të 76 vendimet janë të vlefshme për ruajtje dhe bashkërendim.
Çdo ruajtje mban një kyç skedari për shqyrtuesin gjatë leximit, krahasimit të
revisionit dhe shkrimit atomik. Kështu as dy skeda, as dy procese të veçanta
Node me të njëjtën dosje nuk mund ta mbishkruajnë verbërisht njëra-tjetrën.
Pritja për kyçin është e kufizuar dhe një kyç i lënë nga një proces i mbyllur
pastrohet para riprovimit. Një kyç me PID tjetër që sistemi e raporton ende
të gjallë nuk hiqet vetëm nga mosha; kjo mbron një shkrim të gjatë ose një
proces të pezulluar. Në rastin shumë të rrallë kur sistemi ripërdor PID-në e
një procesi të rrëzuar për një program tjetër, mbyll fillimisht të gjitha
instancat e redaktorit para se të pastrosh manualisht skedarin e fshehtë të
kyçit. Në konflikt,
rekordet bashkohen me tri versione sipas kandidatit, përfshirë heqjet. Kur të
dyja skedat kanë ndryshuar të njëjtin kandidat, ruajtja automatike ndalet dhe
konflikti mbetet i bllokuar edhe kur redaktohen kandidatë të tjerë. Shqyrtuesi
mund t'i krahasojë fushat krah për krah dhe duhet të zgjedhë qartë `Përdor
versionin në disk` ose `Mbaj versionin lokal`; zgjedhja e diskut mund të
zhbëhet. Çdo skedë mban kopjen dhe bazën e vet në shfletues, kështu një
ringarkim e rindërton bashkimin me tri versione pa humbur skicën lokale. Edhe
një skedë e dublikuar merr identitetin e vet të kopjes; shfletuesit që ofrojnë
Web Locks e mbajnë këtë identitet të rezervuar për jetën e skedës, edhe kur ajo
është në sfond. Nëse gjenden variante
nga skeda të mbyllura ose të tjera, `Shkarko JSON` tregon numrin dhe i përfshin
të gjitha si kopje rikuperimi që mund të kontrollohen veçmas.

## Bashkërendimi

Pasi të paktën dy shqyrtues kanë mbuluar të 76 fjalët:

```sh
npm run editorial:reconcile -- reviewer-1 reviewer-2
```

Jep shprehimisht ID-të e shqyrtuesve që do të bashkërendohen. Kështu një
rishikim prove ose i braktisur nuk hyn në rezultat dhe nuk e bllokon çiftin e
zgjedhur. Komanda kërkon të paktën dy ID të ndryshme dhe ndalet nëse mungon
ndonjë skedar ose rishikimi i zgjedhur nuk ka 76/76 vendime.

### Përjashtimi i vetëm i korrikut 2026

Me miratimin e pronarit më 22 korrik 2026, vetëm grupi
`answers-2026-07-62-137-v1`, me hash burimi
`00a765c6b8c593d3812e7e525a39fdba85401283ed77bed5b78edecc0a6a1f25`, u
bashkërendua nga shqyrtuesi `neki` me komandën e posaçme:

```sh
npm run editorial:reconcile -- --allow-single-reviewer-exception neki
```

Kodi kërkon njëkohësisht flag-un, ID-në e saktë të grupit, hash-in e saktë dhe
shqyrtuesin `neki`; një ndryshim i vetëm e refuzon përjashtimin. Ky nuk është
precedent për grupet e ardhshme: ato vazhdojnë të kërkojnë dy shqyrtues të
pavarur. Ky grup përfundoi me 76 miratime, pa refuzime, konflikte ose çështje të
papërfunduara.

Rezultati shkruhet te
`editorial/decisions/answers-2026-07-62-137-v1.json`. Vetëm miratimet e pavarura
mbi të njëjtin tekst pranohen automatikisht për ditore. Vendimet e përbashkëta
`practice_only` dhe `reject_content` mbeten jashtë pool-it ditor; korrigjimet e
papërfunduara dhe mospajtimet kërkojnë ndërhyrje njerëzore.

Codex mund ta lexojë këtë skedar, të propozojë diff-in e metadatave dhe të
ekzekutojë validatorët. Skedari i vendimeve nuk e redakton `src/words.js`.

## Propozimi i epokës

Pas një bashkërendimi pa çështje të hapura krijo një propozim, jo një publikim:

```sh
npm run editorial:epoch -- YYYY-MM-DD
```

Data duhet të jetë pas ditës tashmë të publikuar në Tiranë. Propozimi përmban
listën e ngrirë të ID-ve të miratuara, fjalët e përjashtuara, 90 ditët e para të
planit dhe kontrollin që asnjë datë para fillimit nuk lëviz. Fixture-i duhet ta
mbulojë ditën e publikuar; përndryshe komanda ndalet.
Vetëm pas leximit të diff-it shtohet epoka te `DAILY_EPOCHS`, rigjenerohet
fixture-i dhe ekzekutohet `npm run check`.

Epoka e nisjes me 62 fjalë nuk ndryshohet. Epoka e dytë nis më 23 korrik 2026
me listën e ngrirë të të 138 ID-ve. Epokat e ardhshme përdorin po ashtu një
listë eksplicite `answerIds`, kështu një fjalë e refuzuar nuk bllokon fjalët e
miratuara me ID më të lartë.

## Grupet e ardhshme

Grupet janë skedarë të versionuar dhe të pandryshueshëm. Mos mbishkruaj një
grup pasi ka filluar rishikimi; krijo version ose grup të ri. Kandidatët krejt të
rinj duhet të marrin një çelës të përkohshëm gjatë përgatitjes dhe një ID të
përhershme vetëm kur promovohen në katalog.
