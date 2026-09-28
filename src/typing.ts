// The typing wall: renders words, tracks input per word, moves the caret and
// scrolls so that only three lines are visible.

export interface TestResult {
  wpm: number;
  raw: number;
  accuracy: number;
  correct: number;
  incorrect: number;
  extra: number;
  missed: number;
  seconds: number;
  words: number;
}

export interface LiveStats {
  wpm: number;
  accuracy: number;
  wordIndex: number;
  wordTotal: number;
}

const MAX_EXTRA = 20;
const VISIBLE_LINES = 3;

export class TypingTest {
  private words: string[] = [];
  private typed: string[] = [];
  private cur = 0;
  private wordEls: HTMLElement[] = [];
  private startMs: number | null = null;
  private endMs: number | null = null;
  private keystrokes = 0;
  private correctKeystrokes = 0;
  private lineHeight = 0;
  private scrollOffset = 0;
  private idleTimer = 0;

  private wrapper: HTMLElement;
  private wordsEl: HTMLElement;
  private caret: HTMLElement;
  private onFinish: (result: TestResult) => void;

  constructor(
    wrapper: HTMLElement,
    wordsEl: HTMLElement,
    caret: HTMLElement,
    onFinish: (result: TestResult) => void,
  ) {
    this.wrapper = wrapper;
    this.wordsEl = wordsEl;
    this.caret = caret;
    this.onFinish = onFinish;
    new ResizeObserver(() => this.layout()).observe(wrapper);
  }

  get started(): boolean {
    return this.startMs !== null;
  }

  get finished(): boolean {
    return this.endMs !== null;
  }

  load(words: string[]): void {
    this.words = words;
    this.typed = words.map(() => '');
    this.cur = 0;
    this.startMs = null;
    this.endMs = null;
    this.keystrokes = 0;
    this.correctKeystrokes = 0;

    this.wordsEl.replaceChildren();
    this.wordEls = words.map(() => {
      const el = document.createElement('div');
      el.className = 'word';
      this.wordsEl.appendChild(el);
      return el;
    });
    words.forEach((_, i) => this.renderWord(i));
    this.wordEls[0]?.classList.add('active');
    this.scrollOffset = 0;
    this.wordsEl.style.marginTop = '0px';
    this.caret.classList.add('blink');
    this.layout();
  }

  /** Returns true if the key was consumed. */
  handleKey(e: KeyboardEvent): boolean {
    if (this.finished || this.words.length === 0) return false;

    if (e.key === 'Backspace') {
      e.preventDefault();
      this.backspace(e.ctrlKey || e.altKey || e.metaKey);
      this.afterInput();
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;

    if (e.key === ' ') {
      e.preventDefault();
      if (this.typed[this.cur] === '') return true;
      this.commitWord();
      this.afterInput();
      return true;
    }

    if (e.key.length === 1) {
      e.preventDefault();
      this.typeChar(e.key);
      this.afterInput();
      return true;
    }
    return false;
  }

  live(): LiveStats {
    const r = this.compute();
    return { wpm: r.wpm, accuracy: r.accuracy, wordIndex: this.cur, wordTotal: this.words.length };
  }

  layout(): void {
    const first = this.wordEls[0];
    if (!first) return;
    const style = getComputedStyle(first);
    this.lineHeight = first.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    this.wrapper.style.height = `${this.lineHeight * VISIBLE_LINES}px`;
    this.scrollToCurrent();
    this.moveCaret();
  }

  // ---------- input ----------

  private typeChar(ch: string): void {
    const word = this.words[this.cur];
    const typed = this.typed[this.cur];
    if (typed.length >= word.length + MAX_EXTRA) return;
    this.startMs ??= performance.now();

    this.keystrokes++;
    if (ch === word[typed.length]) this.correctKeystrokes++;
    this.typed[this.cur] = typed + ch;
    this.renderWord(this.cur);

    // like monkeytype, the test ends as soon as the last word is typed correctly
    if (this.cur === this.words.length - 1 && this.typed[this.cur] === word) this.finish();
  }

  private commitWord(): void {
    this.keystrokes++;
    if (this.typed[this.cur] === this.words[this.cur]) this.correctKeystrokes++;
    this.wordEls[this.cur].classList.remove('active');
    this.cur++;
    this.renderWord(this.cur - 1);
    if (this.cur >= this.words.length) {
      this.cur = this.words.length - 1;
      this.finish();
      return;
    }
    this.wordEls[this.cur].classList.add('active');
  }

  private backspace(wholeWord: boolean): void {
    if (this.typed[this.cur] === '') {
      // you may only go back to the previous word if it was typed incorrectly
      const prev = this.cur - 1;
      if (prev < 0 || this.typed[prev] === this.words[prev]) return;
      this.wordEls[this.cur].classList.remove('active');
      this.cur = prev;
      this.wordEls[this.cur].classList.add('active');
      if (!wholeWord) {
        this.renderWord(this.cur);
        return;
      }
    }
    const t = this.typed[this.cur];
    this.typed[this.cur] = wholeWord ? '' : t.slice(0, -1);
    this.renderWord(this.cur);
  }

  private afterInput(): void {
    this.caret.classList.remove('blink');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.caret.classList.add('blink'), 800);
    this.scrollToCurrent();
    this.moveCaret();
  }

  private finish(): void {
    this.endMs = performance.now();
    this.onFinish(this.compute());
  }

  // ---------- rendering ----------

  private renderWord(i: number): void {
    const el = this.wordEls[i];
    if (!el) return;
    const word = this.words[i];
    const typed = this.typed[i];
    const committed = i < this.cur || (this.finished && i === this.cur);
    const frag = document.createDocumentFragment();

    for (let j = 0; j < Math.max(word.length, typed.length); j++) {
      const letter = document.createElement('span');
      letter.className = 'letter';
      if (j < word.length) {
        letter.textContent = word[j];
        if (j < typed.length) letter.classList.add(typed[j] === word[j] ? 'correct' : 'incorrect');
        else if (committed) letter.classList.add('missed');
      } else {
        letter.textContent = typed[j];
        letter.classList.add('incorrect', 'extra');
      }
      frag.appendChild(letter);
    }
    el.replaceChildren(frag);
    el.classList.toggle('error', committed && typed !== word);
  }

  private scrollToCurrent(): void {
    const el = this.wordEls[this.cur];
    if (!el || !this.lineHeight) return;
    const line = Math.round((el.offsetTop - this.wordEls[0].offsetTop) / this.lineHeight);
    this.scrollOffset = -Math.max(0, line - 1) * this.lineHeight;
    this.wordsEl.style.marginTop = `${this.scrollOffset}px`;
  }

  private moveCaret(): void {
    const el = this.wordEls[this.cur];
    if (!el) return;
    const letters = el.children;
    const n = this.typed[this.cur].length;
    // measure against the words container (not the wrapper) so the result
    // doesn't depend on where the scroll animation currently is
    const base = this.wordsEl.getBoundingClientRect();
    let left: number;
    let top: number;
    let height: number;
    if (n < letters.length) {
      const r = letters[n].getBoundingClientRect();
      left = r.left;
      top = r.top;
      height = r.height;
    } else {
      const r = letters[letters.length - 1].getBoundingClientRect();
      left = r.right;
      top = r.top;
      height = r.height;
    }
    const x = left - base.left + this.wordsEl.offsetLeft;
    const y = top - base.top + this.scrollOffset;
    this.caret.style.transform = `translate(${x}px, ${y}px)`;
    this.caret.style.height = `${height}px`;
  }

  // ---------- stats ----------

  private compute(): TestResult {
    let correct = 0;
    let incorrect = 0;
    let extra = 0;
    let missed = 0;
    let wpmChars = 0; // characters of correctly typed words, plus their spaces
    let rawChars = 0;

    const last = this.cur;
    for (let i = 0; i <= last && i < this.words.length; i++) {
      const word = this.words[i];
      const typed = this.typed[i];
      const committed = i < this.cur || this.finished;
      for (let j = 0; j < Math.max(word.length, typed.length); j++) {
        if (j >= word.length) extra++;
        else if (j < typed.length) typed[j] === word[j] ? correct++ : incorrect++;
        else if (committed) missed++;
      }
      rawChars += typed.length;
      const isLastWord = i === this.words.length - 1;
      if (typed === word) wpmChars += word.length + (isLastWord ? 0 : 1);
      if (i < this.cur) rawChars++; // the space
    }

    const end = this.endMs ?? performance.now();
    const seconds = this.startMs === null ? 0 : (end - this.startMs) / 1000;
    const minutes = seconds / 60;
    const perMinute = (chars: number) => (minutes > 0 ? chars / 5 / minutes : 0);

    return {
      wpm: perMinute(wpmChars),
      raw: perMinute(rawChars),
      accuracy: this.keystrokes ? (this.correctKeystrokes / this.keystrokes) * 100 : 100,
      correct,
      incorrect,
      extra,
      missed,
      seconds,
      words: this.words.length,
    };
  }
}
