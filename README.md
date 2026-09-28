# monkeybooks
I both feel like I should be a faster typer and I want to read more. 

A monkeytype-style typing test where the words come from your own books.
Upload a PDF, EPUB or text file and type through it chunk by chunk; your
place in each book is saved.

```sh
npm install
npm run dev     # http://localhost:5173
npm run build   # static site in dist/
```

Everything runs in the browser. Uploaded books are parsed client-side and
stored in IndexedDB, so there is no backend.

## Layout

- `src/parsers.ts`: text extraction for PDF (pdf.js), EPUB (JSZip + DOMParser), txt/md and html
- `src/normalize.ts`: turns extracted text into typeable words (smart quotes, dashes and ligatures, accent folding, PDF hyphenation, Project Gutenberg boilerplate) and applies the punctuation/capitals toggles
- `src/typing.ts`: the typing wall (per-word input, correct/incorrect/extra/missed letters, caret, 3-line scrolling, wpm/accuracy)
- `src/storage.ts`: IndexedDB library (book metadata + text, reading position)
- `src/main.ts`: UI wiring (config bar, library, uploads, results)

Scanned PDFs (images only) have no text layer and are rejected with an error for now.