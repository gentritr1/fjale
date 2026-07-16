# Third-party notices

## Albanian Hunspell dictionary (`sq_AL`)

`src/accepted-words.js` is generated from the LibreOffice Albanian Hunspell
dictionary. The upstream dictionary is licensed under the GNU General Public
License, version 2 or any later version (`GPL-2.0-or-later`).

- Original work: Albanian MySpell dictionary version 1.6.4, 15 July 2011, by Luan Kelmendi
- Upstream project: [LibreOffice Dictionaries](https://github.com/LibreOffice/dictionaries)
- Original Albanian dictionary project: [Shkenca.org](http://www.shkenca.org/k6i/albanian_dictionary_for_myspell_en.html)
- Vendored source: `third_party/sq_AL/sq_AL.dic`
- Source SHA-256: `8fba63fcf7320910803739cc2f0475224a7e8f38f696963d0968e6122a7c0343`
- Full license text: `LICENSE`

FJALË contributors modified the source on 16 July 2026. The generated list is
modified from the upstream dictionary as follows: Hunspell
flags are removed, text is normalized to Unicode NFC, entries containing
characters outside the Albanian alphabet or uppercase letters are omitted,
Albanian digraphs are counted as single letters, and only five-letter entries
are retained. The remaining entries are deduplicated and sorted.

Rebuild the distributed list with:

```sh
node scripts/build-accepted-words.mjs
```

The dictionary and its modified output are provided without warranty, under the
terms in `LICENSE`.
