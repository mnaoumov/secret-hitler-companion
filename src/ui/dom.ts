const PERCENT_DECIMALS = 1;
const PERCENT_SCALE = 100;

export interface ElementOptions {
  readonly className?: string;
  readonly disabled?: boolean | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly pressed?: boolean | undefined;
  readonly text?: string;
  readonly title?: string;
}

export interface SelectOption {
  readonly isDisabled?: boolean | undefined;
  readonly label: string;
  readonly value: string;
}

export interface SelectParams {
  readonly className?: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly value: string;
}

export interface TextInputParams {
  readonly className?: string;
  readonly label: string;
  readonly maxLength: number;
  readonly onInput: (value: string) => void;
  readonly value: string;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  options: ElementOptions = {},
  children: readonly Node[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);

  if (options.className !== undefined) {
    node.className = options.className;
  }

  if (options.text !== undefined) {
    node.textContent = options.text;
  }

  if (options.title !== undefined) {
    node.title = options.title;
  }

  if (options.pressed !== undefined) {
    node.setAttribute('aria-pressed', String(options.pressed));
  }

  if (options.disabled === true && node instanceof HTMLButtonElement) {
    node.disabled = true;
  }

  if (options.onClick) {
    node.addEventListener('click', options.onClick);
  }

  node.append(...children);

  return node;
}

/**
 * Percentages are rendered to one decimal because the differences that matter — 25.0 against 37.5,
 * or 15.4 against 26.4 — live in that digit. An impossible outcome gets a dash rather than `0.0%`,
 * so it reads as "cannot happen" instead of "very unlikely".
 */
export function formatPercentage(value: number): string {
  if (value <= 0) {
    return '—';
  }

  return `${(value * PERCENT_SCALE).toFixed(PERCENT_DECIMALS)}%`;
}

/**
 * The one place a keyboard is used. `onInput` deliberately updates the model without re-rendering —
 * rebuilding the tree on each keystroke would tear the focused field out from under the typist.
 */
/** Unlike the text field, a select fires once per choice, so re-rendering on change is safe. */
export function select(params: SelectParams): HTMLSelectElement {
  const node = document.createElement('select');
  node.className = params.className ?? '';
  node.setAttribute('aria-label', params.label);

  for (const option of params.options) {
    const optionNode = document.createElement('option');
    optionNode.value = option.value;
    optionNode.textContent = option.label;
    optionNode.disabled = option.isDisabled === true;
    node.append(optionNode);
  }

  node.value = params.value;
  node.addEventListener('change', () => {
    params.onChange(node.value);
  });

  return node;
}

export function textInput(params: TextInputParams): HTMLInputElement {
  const node = document.createElement('input');
  node.type = 'text';
  node.className = params.className ?? '';
  node.value = params.value;
  node.setAttribute('aria-label', params.label);
  node.maxLength = params.maxLength;
  node.addEventListener('input', () => {
    params.onInput(node.value);
  });

  return node;
}
