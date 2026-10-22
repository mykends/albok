// Notes are HTML written by the notes editor. Notes from before it existed are plain text; the server
// tells them apart the same way (backend/albok_api/note_html.py).
const FORMATTED = /^\s*<(p|h1|h2|ul|ol)[\s>]/i;

export function isFormattedNote(content: string) {
  return FORMATTED.test(content);
}

/** A note as editor HTML: an old plain-text note becomes one paragraph per line. */
export function noteHtml(content: string) {
  if (!content || isFormattedNote(content)) return content;
  return content
    .split('\n')
    .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('');
}
