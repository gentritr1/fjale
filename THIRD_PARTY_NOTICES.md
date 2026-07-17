# Third-party notices

## Albanian Hunspell dictionary (`sq_AL`)

`src/accepted-words.js` is generated from the LibreOffice Albanian Hunspell
dictionary. The upstream dictionary is licensed under the GNU General Public
License, version 2 or any later version (`GPL-2.0-or-later`).

- Original work: Albanian MySpell dictionary version 1.6.4, 15 July 2011, by Luan Kelmendi
- Upstream project: [LibreOffice Dictionaries](https://github.com/LibreOffice/dictionaries)
- Original Albanian dictionary project: [Shkenca.org](http://www.shkenca.org/k6i/albanian_dictionary_for_myspell_en.html)
- Upstream commit: `07fd313755d396466771b814ab9166bf8ca09213`
  (LibreOffice/dictionaries, 4 January 2021 — "encoding change of Hunspell
  files to UTF-8"). The `.dic` and `.aff` are taken from this same commit.
- Vendored dictionary: `third_party/sq_AL/sq_AL.dic`
- Dictionary SHA-256: `8fba63fcf7320910803739cc2f0475224a7e8f38f696963d0968e6122a7c0343`
- Vendored affix file: `third_party/sq_AL/sq_AL.aff`
  (affix table "Version 1.2 (20.08.2009)" by Luan Kelmendi)
- Affix SHA-256: `d20b6a23431d28fe6d4e6327eedf846dbed1c3ffbb9574fdcfed4ec308422010`
- Full license text: `LICENSE`

The vendored `.aff` was chosen by finding the upstream commit whose `sq_AL.dic`
matches the pinned dictionary SHA-256 above and taking the `sq_AL.aff` from that
same commit. Both checksums are verified in `tests/words.test.js`.

FJALË contributors modified the source on 18 July 2026 (corpus version
`2-hunspell-declared-2026-07-18`). The generated list is modified from the
upstream sources as follows: each dictionary root and every **Hunspell-declared
affix form** it produces (SFX and PFX rules, including declared prefix×suffix
cross-products, honouring each rule's strip/add/condition) is normalized to
Unicode NFC and Albanian lowercase; entries containing characters outside the
Albanian alphabet or uppercase letters are omitted; Albanian digraphs are
counted as single letters; and only forms that tokenize to exactly five
Albanian letters are retained. The remaining forms are deduplicated and sorted.
This is declared-form expansion, not full Albanian morphology: gaps in the
upstream affix tables are gaps in the generated list.

Rebuild the distributed list with:

```sh
node scripts/build-accepted-words.mjs
```

The dictionary and its modified output are provided without warranty, under the
terms in `LICENSE`.
