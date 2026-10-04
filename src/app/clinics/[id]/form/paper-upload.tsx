'use client';

import { useActionState } from 'react';

import type { OpsFormPaper } from '@/lib/api';

import { uploadPaperAction } from '../../../actions';

/// The heaviest paper this panel can carry: the server action's
/// `bodySizeLimit` (`next.config.mjs`), less room for the rest of the form.
/// Checked in the browser so an operator hears the reason in a sentence rather
/// than meeting the platform's own refusal.
const MAX_BYTES = 4 * 1024 * 1024 - 64 * 1024;

/// "3 pages · 595.3 × 841.9 pt each", or each page's size when they differ —
/// the numbers every placement in the layout is measured against.
function pagesLine(pages: OpsFormPaper['pages']): string {
  const size = (p: OpsFormPaper['pages'][number]) =>
    `${p.width.toFixed(1)} × ${p.height.toFixed(1)} pt`;
  const count = pages.length === 1 ? '1 page' : `${pages.length} pages`;
  const sizes = [...new Set(pages.map(size))];
  return sizes.length === 1
    ? `${count} · ${sizes[0]}${pages.length > 1 ? ' each' : ''}`
    : `${count} · ${pages.map((p, i) => `page ${i}: ${size(p)}`).join(' · ')}`;
}

/**
 * → D258 · the clinic's paper — its own PDF form, which every client file the
 * desk downloads is drawn on. Uploading stores it and answers its key; nothing
 * the desk sees changes until a template whose `print.background` names that
 * key is published.
 */
export function PaperUpload({
  clinicId,
  current,
}: {
  clinicId: string;
  /// The paper the live template draws on, if it has a layout.
  current: string | null;
}) {
  const [state, formAction, pending] = useActionState(uploadPaperAction, {
    error: null,
    paper: null,
  });

  return (
    <section className="card">
      <h2>Paper</h2>
      <p className="sub">
        The clinic&rsquo;s own PDF form. With a <code>print</code> layout in the
        template, &ldquo;Download PDF&rdquo; on a client&rsquo;s file gives back
        this paper with their answers written on it. Positions are in PDF
        points from each page&rsquo;s top-left corner; pages count from 0.
      </p>
      {current ? (
        <p className="sub">
          The published template draws on <code>{current}</code>.
        </p>
      ) : null}

      <form action={formAction}>
        <input type="hidden" name="clinicId" value={clinicId} />
        <label className="field">
          <span>Paper PDF (up to 4 MB)</span>
          <input
            type="file"
            name="paper"
            accept="application/pdf,.pdf"
            required
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.setCustomValidity(
                file && file.size > MAX_BYTES
                  ? 'This PDF is over 4 MB. Re-encode it first — the README has the recipe.'
                  : '',
              );
            }}
          />
        </label>

        {state.error ? (
          <p className="notice bad" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.paper ? (
          <p className="notice good" role="status">
            Stored. Put this in the template&rsquo;s <code>print.background</code>:{' '}
            <code className="key">{state.paper.key}</code> &mdash; {pagesLine(state.paper.pages)}.
          </p>
        ) : null}

        <div className="actions">
          <button type="submit" disabled={pending}>
            {pending ? 'Uploading…' : 'Upload paper'}
          </button>
        </div>
      </form>
    </section>
  );
}
