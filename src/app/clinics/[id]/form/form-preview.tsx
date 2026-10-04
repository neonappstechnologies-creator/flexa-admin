import type { OpsFormField, OpsFormTemplate } from '@/lib/api';

/**
 * The template drawn the way the desk will draw it (→ D257) — every box empty,
 * every line blank — so an operator can hold the preview beside the clinic's
 * paper and see that nothing was dropped or reordered in the transcription.
 *
 * It is a reading aid, not the app: the business app's renderer is the truth,
 * and this one only has to be faithful about **what** is on the form and in
 * **what order**. Options run down each column first (CSS columns), which is
 * the order the app lays them out in and the order a paper checklist is read.
 *
 * Imported with `import type` only: `lib/api.ts` throws if it reaches a browser
 * bundle, and a type import is erased before bundling.
 */
export function FormPreview({ template }: { template: OpsFormTemplate }) {
  return (
    <div className="preview" aria-label="Preview of the desk's form">
      <div className="preview-head">
        <span className="preview-title">{template.title}</span>
        {template.subtitle ? (
          <span className="preview-subtitle">{template.subtitle}</span>
        ) : null}
      </div>
      {template.sections.map((section) => (
        <div className="preview-section" key={section.key}>
          <h3>{section.title}</h3>
          {section.fields.map((field) => (
            <PreviewField key={field.key} field={field} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PreviewField({ field }: { field: OpsFormField }) {
  switch (field.type) {
    case 'record':
      return (
        <p className="pf">
          <span className="pf-label">{field.label}</span>
          <span className="pf-auto">
            from the client record ({field.source === 'name' ? 'their name' : 'their phone'})
          </span>
        </p>
      );
    case 'text':
      return (
        <p className="pf">
          {field.label ? <span className="pf-label">{field.label}</span> : null}
          <span className="pf-line">{field.hint ?? ''}</span>
        </p>
      );
    case 'longText':
      return (
        <p className="pf">
          {field.label ? <span className="pf-label">{field.label}</span> : null}
          <span className="pf-box">{field.hint ?? ''}</span>
        </p>
      );
    case 'checkboxes':
    case 'choice':
      return (
        <div className="pf">
          {field.label ? <span className="pf-label">{field.label}</span> : null}
          <ul
            className="pf-options"
            style={{ columnCount: field.columns ?? 1 }}
            aria-label={field.type === 'choice' ? 'Pick one' : 'Tick any'}
          >
            {field.options.map((option) => (
              <li key={option.key}>
                <span aria-hidden="true" className="pf-box-glyph">
                  {field.type === 'choice' ? '○' : '☐'}
                </span>{' '}
                {option.label}
                {option.details ? (
                  <span className="pf-auto"> · opens “{option.details}” when ticked</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'table':
      return (
        <div className="pf">
          {field.label ? <span className="pf-label">{field.label}</span> : null}
          <table className="pf-table">
            <thead>
              <tr>
                <th />
                {field.columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {field.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {field.columns.map((column) => (
                    <td key={column.key} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'visits':
      return (
        <p className="pf">
          {field.label ? <span className="pf-label">{field.label}</span> : null}
          <span className="pf-auto">
            Filled in by Flexa: every visit marked done, numbered, with its service and date.
          </span>
        </p>
      );
  }
}
