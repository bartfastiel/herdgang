// A recipe with its history and all feedback as plain text – the starting point for writing the next version
// (by hand or with an AI agent). Used by the app („Für KI kopieren“) and the command line (`context`).
import type { Comment, Revision } from '../data/types.ts';

const fmt = (t: number) => new Date(t).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function context(e: { title: string; recipe: { id: string }; revisions: Revision[]; comments: Comment[] }): string {
  const out: string[] = [];
  const n = e.revisions.length;
  out.push(`Rezept „${e.title}“ (id ${e.recipe.id}), aktuell Version ${n}.`, '');
  out.push('## Versionen');
  e.revisions.forEach((r, i) => out.push(`- Version ${i + 1} · ${fmt(r.created)} · ${r.author.name}: ${r.message}`));
  out.push('', '## Rückmeldungen');
  if (!e.comments.length) out.push('(keine)');
  for (const c of e.comments) {
    const v = e.revisions.findIndex((r) => r.id === c.revisionId) + 1;
    out.push(`- zu Version ${v || '?'} · ${fmt(c.created)} · ${c.author.name}${c.edited ? ' (bearbeitet)' : ''}: ${c.text.replace(/\n+/g, ' / ')}`);
  }
  out.push('', `## Quelltext Version ${n}`, '', e.revisions[n - 1].source.trimEnd());
  return out.join('\n') + '\n';
}
