import { createElement, type ReactElement } from 'react';
import { pdf, type DocumentProps } from '@react-pdf/renderer';
import type { ExportModel } from './meetingExport';
import { MeetingPdf } from './MeetingPdf';

/**
 * Renders the minutes to a PDF Blob, entirely in the browser.
 *
 * This module is only ever reached through a dynamic `import()` from the
 * export menu, so the PDF engine (several hundred kilobytes) is a chunk of
 * its own that nobody downloads until they ask for a PDF.
 */
export function renderMeetingPdf(model: ExportModel): Promise<Blob> {
  // `pdf()` is typed for a bare <Document> element. MeetingPdf renders exactly
  // one, but its own props are not DocumentProps, so the element is re-typed
  // rather than the component being bent to fit the library's signature.
  const document = createElement(MeetingPdf, { model }) as unknown as ReactElement<DocumentProps>;
  return pdf(document).toBlob();
}
