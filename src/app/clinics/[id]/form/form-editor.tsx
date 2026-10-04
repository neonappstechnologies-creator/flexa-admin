'use client';

import { useActionState } from 'react';

import type { OpsFormTemplate } from '@/lib/api';

import { clientFormAction, switchOffClientFormAction } from '../../../actions';
import { FormPreview } from './form-preview';

/**
 * The template box (→ D257): paste or edit the clinic's form as JSON, **Check**
 * it (the API validates it exactly as publishing would, and the preview shows
 * the desk's view), then **Publish**.
 *
 * One form with two buttons rather than two forms, so the template that is
 * published is the template that was checked — not a second copy the operator
 * re-pasted. It works with JavaScript off (a server action is a POST), which is
 * the path `e2e/drive.mjs` drives.
 */
export function FormEditor({
  clinicId,
  initialText,
  initialPreview,
  currentVersion,
}: {
  clinicId: string;
  initialText: string;
  initialPreview: OpsFormTemplate | null;
  currentVersion: number | null;
}) {
  const [state, formAction, pending] = useActionState(clientFormAction, {
    text: initialText,
    error: null,
    notice: null,
    preview: initialPreview,
  });
  // The sample is offered once the template the API last answered has a paper
  // layout — after a Check, a Publish, or on a form that already has one — so
  // a clinic on plain forms never sees a button that can only refuse.
  const printable = state.preview?.print !== undefined;

  return (
    <section className="card">
      <h2>Template</h2>
      <p className="sub">
        The clinic&rsquo;s paper form, transcribed as JSON. Anything Flexa already
        knows is not retyped: the client&rsquo;s name and phone are{' '}
        <code>record</code> fields, and a session log is a <code>visits</code>{' '}
        field filled in from their visits. A field&rsquo;s <code>key</code> is
        permanent — rename its label freely, but never reuse a key for a
        different question.
      </p>

      <form action={formAction}>
        <input type="hidden" name="clinicId" value={clinicId} />
        <input type="hidden" name="currentVersion" value={currentVersion ?? ''} />
        <label className="field">
          <span>Template JSON</span>
          <textarea
            // Remounts on a new answer so the box shows what the API stored
            // after a publish, without fighting the operator's typing between.
            key={state.text}
            name="template"
            className="code"
            defaultValue={state.text}
            spellCheck={false}
            rows={22}
          />
        </label>

        {state.error ? (
          <p className="notice bad" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.notice ? (
          <p className="notice good" role="status">
            {state.notice}
          </p>
        ) : null}

        <div className="actions">
          <button className="quiet" type="submit" name="intent" value="check" disabled={pending}>
            {pending ? '…' : 'Check'}
          </button>
          <button type="submit" name="intent" value="publish" disabled={pending}>
            {pending ? 'Working…' : 'Publish'}
          </button>
          {printable ? (
            // → D258 · a URL, not an action: React leaves a string `formAction`
            // to the browser, so this posts the same box — whatever is in it,
            // saved or not — to a route that answers the PDF, in a new tab.
            <button
              className="quiet"
              type="submit"
              formAction={`/clinics/${encodeURIComponent(clinicId)}/form/sample`}
              formMethod="post"
              formEncType="multipart/form-data"
              formTarget="_blank"
              disabled={pending}
            >
              Download a sample PDF
            </button>
          ) : null}
        </div>
        {printable ? (
          <p className="sub">
            The sample draws the template in the box on its paper with every box
            ticked, every place written and more sessions than the paper&rsquo;s
            table holds &mdash; hold it against the paper before publishing.
            Nothing is stored.
          </p>
        ) : null}
      </form>

      {state.preview ? <FormPreview template={state.preview} /> : null}
    </section>
  );
}

/**
 * Puts the clinic back on its default notes. Said before the press, not in a
 * dialog after: the filled files are kept, and publishing again brings them
 * back — which is the whole reason this is safe to press.
 */
export function SwitchOffForm({
  clinicId,
  entries,
}: {
  clinicId: string;
  entries: number;
}) {
  const [error, formAction, pending] = useActionState(switchOffClientFormAction, null);

  return (
    <section className="card">
      <h2>Switch the form off</h2>
      <p className="sub">
        The desk goes back to the default free-text notes for this clinic.{' '}
        <strong>
          {entries === 1 ? 'The 1 filled file is' : `The ${entries} filled files are`} kept
        </strong>{' '}
        and come back the moment a version is published again.
      </p>
      <form action={formAction}>
        <input type="hidden" name="clinicId" value={clinicId} />
        {error ? (
          <p className="notice bad" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button className="quiet" type="submit" disabled={pending}>
            {pending ? 'Working…' : 'Switch the form off'}
          </button>
        </div>
      </form>
    </section>
  );
}
