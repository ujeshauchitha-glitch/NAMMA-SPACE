# Fonts — self-hosted under the SIL Open Font License

Offline-finale safety: no layout depends on a network font fetch (standards §3.6).
These files are self-hosted in `public/fonts/`; `src/styles/base.css` declares the
`@font-face` rules with hard system fallbacks, and `index.html` preloads them.

| File | Family | License | Upstream |
|---|---|---|---|
| `archivo-latin-var-wght400-700.woff2` | Archivo (variable, wght 400–700, latin subset) | SIL OFL 1.1 | https://fonts.google.com/specimen/Archivo |
| `ibm-plex-mono-latin-400.woff2` | IBM Plex Mono 400 (latin subset) | SIL OFL 1.1 | https://fonts.google.com/specimen/IBM+Plex+Mono |
| `ibm-plex-mono-latin-500.woff2` | IBM Plex Mono 500 (latin subset) | SIL OFL 1.1 | https://fonts.google.com/specimen/IBM+Plex+Mono |

Full license texts:

- `OFL-Archivo.txt` — Copyright 2020 The Archivo Project Authors
- `OFL-IBMPlexMono.txt` — Copyright 2017 IBM Corp.

Retrieved from the Google Fonts CSS API (latin subsets) on 2026-10-24 and
committed locally. Never fetched at runtime from a third-party host.

OFL grants the right to use, study, copy, merge, embed, modify and redistribute
these fonts (including for commercial sale) provided the fonts themselves are
not sold alone and carry the same licence. See the `.txt` files for the full terms.
