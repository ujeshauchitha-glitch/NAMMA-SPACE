# Round 1 submission documents

| Source | PDF |
|---|---|
| `abstract.html` | `Technical_Abstract.pdf` (≤ 5 pages) |
| `links.html` | `Additional_Links_and_Prototypes.pdf` |

Placeholders are written `[LIKE_THIS]` and highlighted yellow. Edit the HTML, then re-render with headless Chrome (no other tools needed):

```bash
cd docs/submission
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --print-to-pdf="$PWD/Technical_Abstract.pdf" "file://$PWD/abstract.html"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --print-to-pdf="$PWD/Additional_Links_and_Prototypes.pdf" "file://$PWD/links.html"
```

For screenshots, replace each `<div class="shot">…</div>` with `<img src="shot1.png" style="width:100%;height:52mm;object-fit:cover">` so the page count does not change.
