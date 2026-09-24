import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Copy, Download, FileText, FileType2 } from 'lucide-react';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { fileNameFrom, saveBlob } from '@/lib/download';
import { buildMarkdown, buildPlainSummary, type ExportModel } from '../export/meetingExport';

/**
 * Copy the summary, or download the minutes as Markdown or PDF.
 *
 * Everything is built in the browser from what the page already shows:
 * nothing is sent anywhere, and there is no server-side renderer to run on
 * Render's free tier. Copy is a visible button rather than a menu item,
 * because pasting a summary into chat is the common case by far.
 */
export function ExportMenu({ model }: { model: ExportModel }) {
  const [pdfBusy, setPdfBusy] = useState(false);

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(buildPlainSummary(model));
      toast.success('Summary copied');
    } catch {
      // Refused permission, or an insecure context (plain http on a LAN IP).
      toast.error('Could not copy. Your browser blocked clipboard access.');
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([buildMarkdown(model)], { type: 'text/markdown;charset=utf-8' });
    saveBlob(blob, fileNameFrom(model.title, 'md'));
  }

  async function downloadPdf() {
    setPdfBusy(true);
    try {
      // Loaded on first use: the PDF engine is a large chunk nobody else needs.
      const { renderMeetingPdf } = await import('../export/pdf');
      saveBlob(await renderMeetingPdf(model), fileNameFrom(model.title, 'pdf'));
    } catch {
      toast.error('The PDF could not be created. Try the Markdown export instead.');
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => void copySummary()}>
        <Copy aria-hidden="true" />
        Copy summary
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={pdfBusy}>
            {pdfBusy ? <Spinner label="Creating the PDF" /> : <Download aria-hidden="true" />}
            Export
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={downloadMarkdown}>
            <FileText aria-hidden="true" />
            Markdown (.md)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void downloadPdf()}>
            <FileType2 aria-hidden="true" />
            PDF (.pdf)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
