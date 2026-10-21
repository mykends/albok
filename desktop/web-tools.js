// Web tools in the kiosk: which links may open, what counts as the same site, and the list of tools
// open for the current lesson. Pure Node (no Electron), so `npm test` covers it. See
// docs/adr/0001-web-tools-in-the-kiosk.md.
//
// The link rules mirror backend/albok_api/web_tools.py, checked again here so a bad row in the
// database still can't open.

const INTERNAL_SUFFIXES = ['.local', '.lan', '.internal', '.home.arpa', '.localhost', '.test', '.example', '.invalid'];
const LINK_SHORTENERS = new Set(['youtu.be', 'forms.gle', 'bit.ly', 'goo.gl', 't.co', 'tinyurl.com']);
const FILE_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pps', 'ppsx', 'odt', 'ods', 'odp', 'rtf', 'epub', 'csv',
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz',
  'exe', 'msi', 'msix', 'appx', 'dmg', 'pkg', 'apk', 'bat', 'cmd', 'ps1', 'sh', 'jar', 'iso', 'img', 'deb', 'rpm', 'appimage',
]);
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// The URL parser has already turned short, octal and hex IPv4 forms into dotted decimal.
const NUMERIC_LABEL = /^(?:[0-9]+|0x[0-9a-f]*)$/;
const FORBIDDEN_CHARS = /[\s\\\x00-\x1f\x7f]/;
// Lessons are under an hour; anything far beyond that is a bad value, not a lesson end.
const MAX_LESSON_MS = 12 * 60 * 60 * 1000;

function parse(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function bareHost(url) {
  return url.hostname.replace(/\.$/, '');
}

// The normalized link (URL href) if it is a public https page, otherwise null.
function checkLink(raw) {
  if (typeof raw !== 'string') return null;
  const link = raw.trim();
  if (!/^https:\/\//i.test(link) || FORBIDDEN_CHARS.test(link)) return null;
  const authority = link.slice('https://'.length).split(/[/?#]/, 1)[0];
  const url = parse(link);
  if (!url || url.protocol !== 'https:' || authority.includes('@') || url.port !== '') return null;

  const host = bareHost(url);
  const labels = host.split('.');
  if (host.startsWith('[') || NUMERIC_LABEL.test(labels.at(-1))) return null;
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) return null;
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1))) return null;
  if (LINK_SHORTENERS.has(host.replace(/^www\./, ''))) return null;

  let filename;
  try {
    filename = decodeURIComponent(url.pathname.split('/').at(-1)).toLowerCase();
  } catch {
    return null;
  }
  if (filename.includes('.') && FILE_EXTENSIONS.has(filename.split('.').at(-1))) return null;
  return url.href;
}

// "Same site" is the tool link's own host and its subdomains, ignoring a leading www. A
// translate.google.com tool never reaches www.google.com or accounts.google.com.
function isSameSite(toolUrl, target) {
  const tool = parse(toolUrl);
  const url = parse(target);
  if (!tool || !url || url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const site = bareHost(tool).replace(/^www\./, '');
  const host = bareHost(url);
  return host === site || host.endsWith(`.${site}`);
}

// The tools open for the current lesson, as sent by the Albok page on every poll. Everything closes
// when the lesson ends, by this machine's clock, even if the Albok server stops answering.
function createOpenTools({ onChange = () => {} } = {}) {
  let urls = [];
  let timer = null;

  // Every poll sends the list; only a change is reported.
  function replace(next) {
    clearTimeout(timer);
    timer = null;
    const changed = next.length !== urls.length || next.some((url, i) => url !== urls[i]);
    urls = next;
    if (changed) onChange([...urls]);
  }

  return {
    // `endsInMs`: time left in the lesson. Without a valid one, nothing is open.
    set(list, endsInMs) {
      const valid = Array.isArray(list) && Number.isFinite(endsInMs) && endsInMs > 0 && endsInMs <= MAX_LESSON_MS;
      replace(valid ? [...new Set(list.map(checkLink).filter(Boolean))] : []);
      if (urls.length) timer = setTimeout(() => replace([]), endsInMs);
    },
    clear() {
      replace([]);
    },
    list() {
      return [...urls];
    },
    // Electron resolves a webview's src with the URL parser, so compare parsed hrefs, never raw strings.
    allows(src) {
      const url = parse(src);
      return Boolean(url) && urls.includes(url.href);
    },
  };
}

module.exports = { checkLink, createOpenTools, isSameSite };
