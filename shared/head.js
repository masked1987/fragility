// Splits a reading headline into a short title and the rest, for the big title font.
// Every headline is written "Short label: the details" (a few use ". " instead),
// e.g. "Leaning down: a drop to ~2,190 could run" -> title "Leaning down",
// rest "A drop to ~2,190 could run". Pure, runs in Node.

const MAX_TITLE = 42; // longer than this and the whole line stays as the title

export function splitHead(s) {
  const text = String(s == null ? '' : s).trim();
  let i = text.indexOf(': ');
  if (i < 0) i = text.indexOf('. ');
  if (i <= 0 || i > MAX_TITLE) return { title: text, rest: '' };
  const rest = text.slice(i + 2).trim();
  return { title: text.slice(0, i), rest: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Reading-card headline: big short title, then the details in normal text.
export function headHtml(s) {
  const h = splitHead(s);
  return '<p class="verdict-head">' + esc(h.title) + '</p>' +
    (h.rest ? '<p class="verdict-sub">' + esc(h.rest) + '</p>' : '');
}
