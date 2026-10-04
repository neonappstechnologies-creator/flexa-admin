import { ApiError, samplePdf } from '@/lib/api';
import { isSignedIn } from '@/lib/session';

/// Plain text, never HTML: a refusal opens in a tab of its own with no page
/// around it, and text cannot carry markup back into that tab.
const TEXT = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

/**
 * → D258 · the template in the box, drawn on the clinic's paper — every box
 * ticked, every place written, more sessions than the paper's table holds. It
 * is how an operator holds a layout's numbers against the paper **before**
 * publishing: the box's text travels as a draft, and nothing is stored.
 *
 * A route rather than a server action because its answer is a file, not a
 * page. The editor's "Download a sample PDF" button posts the editor's own
 * form here (a URL `formAction`, which React leaves to the browser) into a new
 * tab, and the browser shows the PDF.
 *
 * The session is checked here for `requireSession`'s reason: `proxy.ts`'s
 * matcher covers this path today and turns a signed-out POST away at the edge,
 * so this is the second line — kept for the day a route moves out from under
 * the matcher.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await isSignedIn())) {
    return new Response('You are signed out. Sign in to the panel and try again.', {
      status: 401,
      headers: TEXT,
    });
  }
  const { id } = await params;

  let template: unknown;
  try {
    template = JSON.parse(String((await request.formData()).get('template') ?? ''));
  } catch (error) {
    return new Response(`That is not valid JSON: ${(error as Error).message}`, {
      status: 400,
      headers: TEXT,
    });
  }

  try {
    return new Response(await samplePdf(id, template), {
      headers: {
        'content-type': 'application/pdf',
        // Inline, so the new tab shows it; the name is what a save offers.
        'content-disposition': 'inline; filename="Sample.pdf"',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return new Response(error.message, { status: 400, headers: TEXT });
    }
    throw error;
  }
}
