/**
 * Page Scanner — Captures DOM state for AI-powered QA analysis.
 * Only used in test mode. Captures links, images, text content,
 * visible elements, console errors, and page structure.
 */

export interface PageScanResult {
  url: string;
  title: string;
  timestamp: string;
  viewport: { width: number; height: number };
  links: LinkInfo[];
  images: ImageInfo[];
  buttons: ButtonInfo[];
  forms: FormInfo[];
  headings: HeadingInfo[];
  emptyStates: string[];
  suspiciousText: string[];
  consoleErrors: string[];
  accessibilityIssues: string[];
  visibleText: string;
  componentTree: string[];
}

interface LinkInfo {
  text: string;
  href: string;
  isBroken: boolean;
  reason?: string;
}

interface ImageInfo {
  src: string;
  alt: string;
  hasAlt: boolean;
  isPlaceholder: boolean;
  isLoaded: boolean;
}

interface ButtonInfo {
  text: string;
  disabled: boolean;
  type: string;
}

interface FormInfo {
  id: string;
  fields: string[];
  hasSubmit: boolean;
}

interface HeadingInfo {
  level: number;
  text: string;
}

// Patterns that suggest fake/placeholder data
const FAKE_DATA_PATTERNS = [
  /lorem ipsum/i,
  /placeholder/i,
  /example\.com/i,
  /test@test/i,
  /foo\s?bar/i,
  /john\s?doe/i,
  /jane\s?doe/i,
  /\$0\.00/,
  /xxx+/i,
  /TODO/,
  /FIXME/,
  /HACK/,
  /sample\s?data/i,
  /dummy/i,
  /asdf/i,
];

const PLACEHOLDER_IMAGE_PATTERNS = [
  /placeholder\.(svg|png|jpg)/i,
  /via\.placeholder/i,
  /placehold\.it/i,
  /picsum/i,
  /unsplash\.it/i,
  /data:image\/svg\+xml/,
];

// Collect console errors captured during page life
const capturedErrors: string[] = [];
let errorListenerInstalled = false;

function installErrorCapture() {
  if (errorListenerInstalled) return;
  errorListenerInstalled = true;

  const origError = console.error;
  console.error = (...args: any[]) => {
    capturedErrors.push(args.map(a => String(a)).join(' ').slice(0, 200));
    if (capturedErrors.length > 50) capturedErrors.shift();
    origError.apply(console, args);
  };

  window.addEventListener('error', (e) => {
    capturedErrors.push(`[JS Error] ${e.message} at ${e.filename}:${e.lineno}`);
  });

  window.addEventListener('unhandledrejection', (e) => {
    capturedErrors.push(`[Unhandled Promise] ${String(e.reason).slice(0, 200)}`);
  });
}

export function scanPage(): PageScanResult {
  installErrorCapture();

  const result: PageScanResult = {
    url: window.location.pathname + window.location.search,
    title: document.title,
    timestamp: new Date().toISOString(),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    links: [],
    images: [],
    buttons: [],
    forms: [],
    headings: [],
    emptyStates: [],
    suspiciousText: [],
    consoleErrors: [...capturedErrors],
    accessibilityIssues: [],
    componentTree: [],
    visibleText: '',
  };

  // Scan links
  document.querySelectorAll('a[href]').forEach((el) => {
    const a = el as HTMLAnchorElement;
    const href = a.getAttribute('href') || '';
    const text = a.textContent?.trim().slice(0, 80) || '';
    const isBroken = href === '#' || href === '' || href === 'undefined' || href === 'null';
    const reason = isBroken ? `Invalid href: "${href}"` : undefined;
    result.links.push({ text, href, isBroken, reason });
  });

  // Scan images
  document.querySelectorAll('img').forEach((el) => {
    const img = el as HTMLImageElement;
    const src = img.getAttribute('src') || '';
    const alt = img.getAttribute('alt') || '';
    const isPlaceholder = PLACEHOLDER_IMAGE_PATTERNS.some(p => p.test(src));
    result.images.push({
      src: src.slice(0, 120),
      alt: alt.slice(0, 80),
      hasAlt: !!alt,
      isPlaceholder,
      isLoaded: img.complete && img.naturalHeight > 0,
    });
  });

  // Scan buttons
  document.querySelectorAll('button, [role="button"]').forEach((el) => {
    const btn = el as HTMLButtonElement;
    result.buttons.push({
      text: btn.textContent?.trim().slice(0, 60) || '[no text]',
      disabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true',
      type: btn.getAttribute('type') || 'button',
    });
  });

  // Scan forms
  document.querySelectorAll('form').forEach((el, i) => {
    const form = el as HTMLFormElement;
    const fields: string[] = [];
    form.querySelectorAll('input, select, textarea').forEach((f) => {
      const input = f as HTMLInputElement;
      fields.push(`${input.tagName.toLowerCase()}[${input.type || 'text'}]${input.name ? `(${input.name})` : ''}`);
    });
    const hasSubmit = !!form.querySelector('[type="submit"], button:not([type="button"])');
    result.forms.push({ id: form.id || `form-${i}`, fields, hasSubmit });
  });

  // Scan headings
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
    const level = parseInt(el.tagName[1]);
    result.headings.push({ level, text: el.textContent?.trim().slice(0, 100) || '' });
  });

  // Look for empty states / no-data indicators
  document.querySelectorAll('[class*="empty"], [class*="no-data"], [class*="placeholder"]').forEach((el) => {
    const text = el.textContent?.trim().slice(0, 100);
    if (text) result.emptyStates.push(text);
  });

  // Scan for suspicious/fake text in visible content
  const bodyText = document.body.innerText || '';
  result.visibleText = bodyText.slice(0, 3000);

  for (const pattern of FAKE_DATA_PATTERNS) {
    const match = bodyText.match(pattern);
    if (match) {
      const idx = match.index || 0;
      const context = bodyText.slice(Math.max(0, idx - 30), idx + match[0].length + 30).trim();
      result.suspiciousText.push(`"${match[0]}" found near: "...${context}..."`);
    }
  }

  // Basic accessibility checks
  const imgsNoAlt = result.images.filter(i => !i.hasAlt).length;
  if (imgsNoAlt > 0) result.accessibilityIssues.push(`${imgsNoAlt} image(s) missing alt text`);

  const btnsNoText = result.buttons.filter(b => b.text === '[no text]' || b.text === '').length;
  if (btnsNoText > 0) result.accessibilityIssues.push(`${btnsNoText} button(s) with no accessible text`);

  const h1Count = result.headings.filter(h => h.level === 1).length;
  if (h1Count === 0) result.accessibilityIssues.push('No H1 heading found');
  if (h1Count > 1) result.accessibilityIssues.push(`Multiple H1 headings (${h1Count})`);

  // Detect React component tree from data attributes
  document.querySelectorAll('[data-testid], [data-component]').forEach((el) => {
    const id = el.getAttribute('data-testid') || el.getAttribute('data-component');
    if (id) result.componentTree.push(id);
  });

  return result;
}

/**
 * Format scan result as a compact text summary for inclusion in AI messages.
 */
export function formatScanForAI(scan: PageScanResult): string {
  const sections: string[] = [];

  sections.push(`## Page Scan: ${scan.url}`);
  sections.push(`Title: ${scan.title} | Viewport: ${scan.viewport.width}×${scan.viewport.height}`);
  sections.push(`Scanned at: ${scan.timestamp}`);

  // Issues summary
  const brokenLinks = scan.links.filter(l => l.isBroken);
  const placeholderImages = scan.images.filter(i => i.isPlaceholder);
  const unloadedImages = scan.images.filter(i => !i.isLoaded);

  if (brokenLinks.length || placeholderImages.length || scan.suspiciousText.length || scan.consoleErrors.length || scan.accessibilityIssues.length) {
    sections.push('\n### ⚠️ Issues Found');

    if (brokenLinks.length) {
      sections.push(`**Broken links (${brokenLinks.length}):**`);
      brokenLinks.slice(0, 10).forEach(l => sections.push(`- "${l.text}" → ${l.href} (${l.reason})`));
    }

    if (placeholderImages.length) {
      sections.push(`**Placeholder images (${placeholderImages.length}):**`);
      placeholderImages.slice(0, 5).forEach(i => sections.push(`- ${i.src}`));
    }

    if (unloadedImages.length) {
      sections.push(`**Failed images (${unloadedImages.length}):**`);
      unloadedImages.slice(0, 5).forEach(i => sections.push(`- ${i.src}`));
    }

    if (scan.suspiciousText.length) {
      sections.push(`**Suspicious/fake data (${scan.suspiciousText.length}):**`);
      scan.suspiciousText.slice(0, 5).forEach(t => sections.push(`- ${t}`));
    }

    if (scan.consoleErrors.length) {
      sections.push(`**Console errors (${scan.consoleErrors.length}):**`);
      scan.consoleErrors.slice(0, 5).forEach(e => sections.push(`- ${e}`));
    }

    if (scan.accessibilityIssues.length) {
      sections.push(`**Accessibility issues:**`);
      scan.accessibilityIssues.forEach(a => sections.push(`- ${a}`));
    }
  } else {
    sections.push('\n### ✅ No obvious issues detected');
  }

  // Page structure
  sections.push('\n### Page Structure');
  sections.push(`- ${scan.headings.length} headings, ${scan.links.length} links, ${scan.images.length} images`);
  sections.push(`- ${scan.buttons.length} buttons (${scan.buttons.filter(b => b.disabled).length} disabled)`);
  sections.push(`- ${scan.forms.length} forms`);

  if (scan.headings.length) {
    sections.push('\n**Headings:**');
    scan.headings.slice(0, 10).forEach(h => sections.push(`${'  '.repeat(h.level - 1)}H${h.level}: ${h.text}`));
  }

  // Visible text excerpt
  sections.push('\n### Visible Text (first 1500 chars)');
  sections.push(scan.visibleText.slice(0, 1500));

  return sections.join('\n');
}
