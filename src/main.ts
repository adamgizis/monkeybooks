import './style.css';
import { applyOptions, textToWords } from './normalize';
import { parseFile } from './parsers';
import { SAMPLE_TEXT, SAMPLE_TITLE } from './sample';
import * as storage from './storage';
import type { BookMeta } from './storage';
import { TypingTest, type TestResult } from './typing';

// ---------- settings ----------

interface Settings {
  chunk: number;
  punctuation: boolean;
  capitals: boolean;
  bookId: string | null;
}

const SETTINGS_KEY = 'monkeybooks-settings';
const SEEDED_KEY = 'monkeybooks-seeded';
const CHUNK_SIZES = [25, 50, 100, 250];

function loadSettings(): Settings {
  const defaults: Settings = { chunk: 50, punctuation: true, capitals: true, bookId: null };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

const settings = loadSettings();
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

// ---------- elements ----------

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const els = {
  test: $('#test'),
  result: $('#result'),
  wrapper: $('#words-wrapper'),
  words: $('#words'),
  caret: $('#caret'),
  input: $<HTMLInputElement>('#hidden-input'),
  live: $('#live'),
  liveCount: $('#live-count'),
  liveWpm: $('#live-wpm'),
  liveAcc: $('#live-acc'),
  bookTitle: $('#book-title'),
  bookProgress: $('#book-progress'),
  bookProgressFill: $('#book-progress-fill'),
  bookProgressLabel: $('#book-progress-label'),
  library: $('#library'),
  bookList: $<HTMLUListElement>('#book-list'),
  fileInput: $<HTMLInputElement>('#file-input'),
  dropOverlay: $('#drop-overlay'),
  toast: $('#toast'),
};

// ---------- state ----------

let book: BookMeta | null = null;
let bookWords: string[] = [];
let chunkStart = 0;
let chunkLength = 0; // number of book words covered by the current chunk
let liveTimer = 0;

const test = new TypingTest(els.wrapper, els.words, els.caret, onFinish);

// ---------- books ----------

async function openBook(id: string): Promise<boolean> {
  const meta = await storage.getMeta(id);
  if (!meta) return false;
  book = meta;
  bookWords = await storage.getWords(id);
  book.lastOpened = Date.now();
  await storage.saveMeta(book);
  settings.bookId = id;
  saveSettings();
  return true;
}

async function addFile(file: File): Promise<void> {
  const id = `${file.name}:${file.size}`;
  if (await storage.getMeta(id)) {
    toast(`"${file.name}" is already in your library - picking up where you left off`);
  } else {
    toast(`reading ${file.name}...`, { sticky: true });
    const parsed = await parseFile(file, (f) =>
      toast(`reading ${file.name}... ${Math.round(f * 100)}%`, { sticky: true }),
    );
    const words = textToWords(parsed.text);
    if (words.length < 10) {
      throw new Error(
        file.name.toLowerCase().endsWith('.pdf')
          ? `No text found in "${file.name}". It may be a scanned PDF (images only).`
          : `No text found in "${file.name}".`,
      );
    }
    const now = Date.now();
    await storage.addBook(
      { id, title: parsed.title, wordCount: words.length, position: 0, addedAt: now, lastOpened: now },
      words,
    );
    toast(`added "${parsed.title}" - ${words.length.toLocaleString()} words`);
  }
  await openBook(id);
}

async function handleFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files);
  if (!list.length) return;
  closeLibrary();
  for (const file of list) {
    try {
      await addFile(file);
    } catch (err) {
      console.error(err);
      toast(err instanceof Error ? err.message : String(err), { error: true });
    }
  }
  startTest();
}

async function seedSample(): Promise<void> {
  if (localStorage.getItem(SEEDED_KEY)) return;
  localStorage.setItem(SEEDED_KEY, '1');
  const words = textToWords(SAMPLE_TEXT);
  const now = Date.now();
  await storage.addBook(
    { id: 'sample', title: SAMPLE_TITLE, wordCount: words.length, position: 0, addedAt: now, lastOpened: 0 },
    words,
  );
}

// Snap a position forward to the start of a sentence (within reason).
function sentenceStart(pos: number): number {
  for (let i = pos; i < Math.min(bookWords.length, pos + 200); i++) {
    if (i === 0 || /[.!?]["')\]]*$/.test(bookWords[i - 1])) return i;
  }
  return pos;
}

// ---------- test flow ----------

function startTest(): void {
  showView('test');
  stopLive();
  if (!book || !bookWords.length) {
    test.load([]);
    els.bookTitle.textContent = 'no book selected - upload one to get started';
    renderBookBar();
    return;
  }

  if (book.position >= bookWords.length) {
    book.position = 0;
    void storage.saveMeta(book);
    toast('you finished the book! starting again from the beginning');
  }

  // keep taking words until the options (e.g. no punctuation) leave enough to type
  chunkStart = book.position;
  let end = chunkStart;
  let words: string[] = [];
  while (words.length < settings.chunk && end < bookWords.length) {
    const next = Math.min(bookWords.length, end + (settings.chunk - words.length));
    words = words.concat(applyOptions(bookWords.slice(end, next), settings));
    end = next;
  }
  chunkLength = end - chunkStart;

  test.load(words);
  renderBookBar();
  focusInput();
}

function onFinish(result: TestResult): void {
  stopLive();
  if (book) {
    book.position = chunkStart + chunkLength;
    void storage.saveMeta(book);
  }
  $('#res-wpm').textContent = String(Math.round(result.wpm));
  $('#res-acc').textContent = `${Math.floor(result.accuracy)}%`;
  $('#res-raw').textContent = String(Math.round(result.raw));
  $('#res-chars').textContent = `${result.correct}/${result.incorrect}/${result.extra}/${result.missed}`;
  $('#res-time').textContent = `${Math.round(result.seconds)}s`;
  $('#res-book').textContent = book ? `${percent(book.position, book.wordCount)}%` : '-';
  showView('result');
  renderBookBar();
}

function nextChunk(): void {
  startTest();
}

function retryChunk(): void {
  if (book) {
    book.position = chunkStart;
    void storage.saveMeta(book);
  }
  startTest();
}

function restart(): void {
  // an unfinished chunk hasn't moved the book position, so this reloads it
  startTest();
}

function showView(view: 'test' | 'result'): void {
  els.test.hidden = view !== 'test';
  els.result.hidden = view !== 'result';
  if (view === 'test') test.layout();
}

// ---------- live stats ----------

function startLive(): void {
  if (liveTimer) return;
  els.live.classList.add('running');
  const tick = () => {
    const s = test.live();
    els.liveCount.textContent = `${s.wordIndex}/${s.wordTotal}`;
    els.liveWpm.textContent = String(Math.round(s.wpm));
    els.liveAcc.textContent = `${Math.floor(s.accuracy)}%`;
  };
  tick();
  liveTimer = window.setInterval(tick, 250);
}

function stopLive(): void {
  clearInterval(liveTimer);
  liveTimer = 0;
  els.live.classList.remove('running');
}

// ---------- book bar ----------

const percent = (pos: number, total: number) => (total ? ((pos / total) * 100).toFixed(1) : '0.0');

function renderBookBar(): void {
  if (!book) {
    els.bookProgressFill.style.width = '0';
    els.bookProgressLabel.textContent = '';
    return;
  }
  const pos = els.result.hidden ? chunkStart : book.position;
  els.bookTitle.textContent = book.title;
  els.bookTitle.title = book.title;
  els.bookProgressFill.style.width = `${(pos / book.wordCount) * 100}%`;
  els.bookProgressLabel.textContent = `${percent(pos, book.wordCount)}% · ${pos.toLocaleString()}/${book.wordCount.toLocaleString()} words`;
}

els.bookProgress.addEventListener('click', (e) => {
  if (!book) return;
  const rect = els.bookProgress.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  book.position = sentenceStart(Math.floor(fraction * (bookWords.length - 1)));
  void storage.saveMeta(book);
  startTest();
});

// ---------- library ----------

async function openLibrary(): Promise<void> {
  await renderLibrary();
  els.library.hidden = false;
}

function closeLibrary(): void {
  els.library.hidden = true;
  focusInput();
}

async function renderLibrary(): Promise<void> {
  const books = await storage.listBooks();
  els.bookList.replaceChildren();
  if (!books.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'your library is empty';
    els.bookList.appendChild(li);
    return;
  }
  for (const b of books) {
    const li = document.createElement('li');
    li.classList.toggle('current', b.id === book?.id);

    const open = document.createElement('button');
    open.className = 'open';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = b.title;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${b.wordCount.toLocaleString()} words · ${percent(b.position, b.wordCount)}% done`;
    open.append(title, meta);
    open.addEventListener('click', async () => {
      await openBook(b.id);
      closeLibrary();
      startTest();
    });

    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = 'delete';
    del.addEventListener('click', async () => {
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm');
        del.textContent = 'sure?';
        return;
      }
      await storage.deleteBook(b.id);
      if (book?.id === b.id) {
        book = null;
        bookWords = [];
        settings.bookId = null;
        saveSettings();
        const [first] = await storage.listBooks();
        if (first) await openBook(first.id);
        startTest();
      }
      await renderLibrary();
    });

    li.append(open, del);
    els.bookList.appendChild(li);
  }
}

$('#library-btn').addEventListener('click', () => void openLibrary());
$('#library-close').addEventListener('click', closeLibrary);
els.library.addEventListener('click', (e) => {
  if (e.target === els.library) closeLibrary();
});

// ---------- uploads ----------

const chooseFile = () => els.fileInput.click();
$('#upload-btn').addEventListener('click', chooseFile);
$('#library-upload').addEventListener('click', chooseFile);
els.fileInput.addEventListener('change', () => {
  if (els.fileInput.files) void handleFiles(els.fileInput.files);
  els.fileInput.value = '';
});

let dragDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  els.dropOverlay.hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) els.dropOverlay.hidden = true;
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.dropOverlay.hidden = true;
  if (e.dataTransfer?.files) void handleFiles(e.dataTransfer.files);
});

// ---------- config bar ----------

function renderConfig(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
    const key = btn.dataset.toggle as 'punctuation' | 'capitals';
    btn.classList.toggle('active', settings[key]);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-chunk]').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.chunk) === settings.chunk);
  });
}

document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const key = btn.dataset.toggle as 'punctuation' | 'capitals';
    settings[key] = !settings[key];
    saveSettings();
    renderConfig();
    if (els.result.hidden) restart();
  }),
);

document.querySelectorAll<HTMLButtonElement>('[data-chunk]').forEach((btn) =>
  btn.addEventListener('click', () => {
    settings.chunk = Number(btn.dataset.chunk);
    saveSettings();
    renderConfig();
    if (els.result.hidden) restart();
  }),
);

// ---------- keyboard / focus ----------

function focusInput(): void {
  if (!els.library.hidden || els.test.hidden) return;
  els.input.focus({ preventScroll: true });
}

els.input.addEventListener('focus', () => els.wrapper.classList.remove('blurred'));
els.input.addEventListener('blur', () => els.wrapper.classList.add('blurred'));
els.wrapper.addEventListener('click', focusInput);
$('#restart-btn').addEventListener('click', restart);
$('#next-btn').addEventListener('click', nextChunk);
$('#retry-btn').addEventListener('click', retryChunk);

document.addEventListener('keydown', (e) => {
  if (!els.library.hidden) {
    if (e.key === 'Escape') closeLibrary();
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    if (els.result.hidden) restart();
    else retryChunk();
    return;
  }

  if (!els.result.hidden) {
    if (e.key === 'Enter') {
      e.preventDefault();
      nextChunk();
    }
    return;
  }

  if (e.key === 'Escape') {
    els.input.blur();
    return;
  }

  // typing anywhere on the page goes to the test
  if (document.activeElement !== els.input) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    focusInput();
  }
  if (test.handleKey(e) && test.started && !test.finished) startLive();
});

// ---------- toast ----------

let toastTimer = 0;
function toast(message: string, opts: { error?: boolean; sticky?: boolean } = {}): void {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', !!opts.error);
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  if (!opts.sticky) toastTimer = window.setTimeout(() => (els.toast.hidden = true), opts.error ? 6000 : 3000);
}

// ---------- boot ----------

async function init(): Promise<void> {
  if (!CHUNK_SIZES.includes(settings.chunk)) settings.chunk = 50;
  renderConfig();
  await seedSample();
  let opened = settings.bookId ? await openBook(settings.bookId) : false;
  if (!opened) {
    const [first] = await storage.listBooks();
    if (first) opened = await openBook(first.id);
  }
  startTest();
}

void init();
