// Extracts plain text from uploaded files (pdf, epub, txt/md, html).

export interface ParsedFile {
  title: string;
  text: string;
}

type Progress = (fraction: number) => void;

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

export async function parseFile(file: File, onProgress?: Progress): Promise<ParsedFile> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'pdf':
      return parsePdf(file, onProgress);
    case 'epub':
      return parseEpub(file, onProgress);
    case 'html':
    case 'htm':
    case 'xhtml': {
      const doc = parseMarkup(await file.text());
      return { title: baseName(file.name), text: extractText(doc.body ?? doc.documentElement) };
    }
    case 'txt':
    case 'text':
    case 'md':
    case 'markdown':
    case '':
      return { title: baseName(file.name), text: await file.text() };
    default:
      if (file.type.startsWith('text/')) return { title: baseName(file.name), text: await file.text() };
      throw new Error(`Unsupported file type ".${ext}". Use a .pdf, .epub or .txt file.`);
  }
}

// ---------- PDF ----------

async function parsePdf(file: File, onProgress?: Progress): Promise<ParsedFile> {
  // loaded lazily so the (large) pdf.js bundle is only fetched when needed
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let line = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = '';
        }
      }
      if (line) lines.push(line);
      // drop lines that are just page numbers
      pages.push(lines.filter((l) => !/^\s*\d+\s*$/.test(l)).join('\n'));
      page.cleanup();
      onProgress?.(p / doc.numPages);
    }
    const meta = await doc.getMetadata().catch(() => null);
    const metaTitle = (meta?.info as { Title?: string } | undefined)?.Title?.trim();
    return { title: metaTitle || baseName(file.name), text: pages.join('\n') };
  } finally {
    await task.destroy();
  }
}

// ---------- EPUB ----------

async function parseEpub(file: File, onProgress?: Progress): Promise<ParsedFile> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const readZip = async (path: string): Promise<string | null> => {
    const entry = zip.file(path) ?? zip.file(new RegExp(`^${escapeRegex(path)}$`, 'i'))[0];
    return entry ? entry.async('string') : null;
  };

  const containerXml = await readZip('META-INF/container.xml');
  if (!containerXml) throw new Error('Invalid EPUB: missing META-INF/container.xml');
  const rootPath = parseXml(containerXml)
    .getElementsByTagNameNS('*', 'rootfile')[0]
    ?.getAttribute('full-path');
  if (!rootPath) throw new Error('Invalid EPUB: no rootfile in container.xml');

  const opfXml = await readZip(rootPath);
  if (!opfXml) throw new Error(`Invalid EPUB: missing ${rootPath}`);
  const opf = parseXml(opfXml);

  const manifest = new Map<string, string>();
  for (const item of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  }

  const spine = Array.from(opf.getElementsByTagNameNS('*', 'itemref'))
    .filter((ref) => ref.getAttribute('linear') !== 'no')
    .map((ref) => manifest.get(ref.getAttribute('idref') ?? ''))
    .filter((href): href is string => !!href);

  const chapters: string[] = [];
  for (let i = 0; i < spine.length; i++) {
    const markup = await readZip(resolveHref(rootPath, spine[i]));
    if (markup) {
      const doc = parseMarkup(markup);
      chapters.push(extractText(doc.body ?? doc.documentElement));
    }
    onProgress?.((i + 1) / spine.length);
  }

  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim();
  return { title: title || baseName(file.name), text: chapters.join('\n\n') };
}

// Resolves a manifest href (relative to the OPF file) to a path inside the zip.
function resolveHref(opfPath: string, href: string): string {
  const url = new URL(href.split('#')[0], `http://epub/${opfPath}`);
  return decodeURIComponent(url.pathname.slice(1));
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

// EPUB chapters are XHTML, but plenty of real-world files aren't well-formed.
function parseMarkup(markup: string): Document {
  const xhtml = new DOMParser().parseFromString(markup, 'application/xhtml+xml');
  if (!xhtml.getElementsByTagName('parsererror').length) return xhtml;
  return new DOMParser().parseFromString(markup, 'text/html');
}

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'nav', 'ol',
  'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul',
]);
const SKIP = new Set(['head', 'script', 'style', 'title', 'svg', 'math', 'rt', 'rp', 'noscript']);

// Like textContent, but keeps block elements from gluing words together
// ("</p><p>" would otherwise turn "end.Start" into one word).
function extractText(root: Element): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out.push(child.nodeValue ?? '');
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        const name = el.localName.toLowerCase();
        if (SKIP.has(name)) continue;
        // footnote markers like <sup>12</sup> would glue onto the previous word
        if (name === 'sup' && /^\s*[\d*†‡]+\s*$/.test(el.textContent ?? '')) continue;
        const block = BLOCK.has(name);
        if (block) out.push('\n');
        walk(el);
        if (block) out.push('\n');
      }
    }
  };
  walk(root);
  return out.join('');
}
