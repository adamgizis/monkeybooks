// Books live in IndexedDB: whole novels quickly exceed localStorage's ~5MB.
// Metadata and text are kept in separate stores so saving reading progress
// doesn't rewrite the entire book.

export interface BookMeta {
  id: string;
  title: string;
  wordCount: number;
  position: number; // index of the next word to type
  addedAt: number;
  lastOpened: number;
}

const DB_NAME = 'monkey-books';
const META = 'meta';
const TEXT = 'text';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: 'id' });
      req.result.createObjectStore(TEXT);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listBooks(): Promise<BookMeta[]> {
  const tx = (await db()).transaction(META, 'readonly');
  const books = await request(tx.objectStore(META).getAll() as IDBRequest<BookMeta[]>);
  return books.sort((a, b) => b.lastOpened - a.lastOpened);
}

export async function getMeta(id: string): Promise<BookMeta | undefined> {
  const tx = (await db()).transaction(META, 'readonly');
  return request(tx.objectStore(META).get(id) as IDBRequest<BookMeta | undefined>);
}

export async function getWords(id: string): Promise<string[]> {
  const tx = (await db()).transaction(TEXT, 'readonly');
  const text = await request(tx.objectStore(TEXT).get(id) as IDBRequest<string | undefined>);
  return text ? text.split(' ') : [];
}

export async function addBook(meta: BookMeta, words: string[]): Promise<void> {
  const tx = (await db()).transaction([META, TEXT], 'readwrite');
  tx.objectStore(META).put(meta);
  tx.objectStore(TEXT).put(words.join(' '), meta.id);
  await done(tx);
}

export async function saveMeta(meta: BookMeta): Promise<void> {
  const tx = (await db()).transaction(META, 'readwrite');
  tx.objectStore(META).put(meta);
  await done(tx);
}

export async function deleteBook(id: string): Promise<void> {
  const tx = (await db()).transaction([META, TEXT], 'readwrite');
  tx.objectStore(META).delete(id);
  tx.objectStore(TEXT).delete(id);
  await done(tx);
}
