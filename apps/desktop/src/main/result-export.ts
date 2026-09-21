import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog } from 'electron';
import type { ResultExportRequest, ResultExportResult } from '../shared/ipc.js';
import { errnoText, MSG, saveFailedText } from '../shared/messages.js';
import { safeFileName } from '../shared/safe-file-name.js';
import { writeFileAtomic } from './fs-atomic.js';

export const MAX_REPORT_BYTES = 1024 * 1024;
export const REPORT_TIMEOUT_MS = 30_000;
let exporting = false;

/** 最初に置くCSPは、後続HTMLが別のCSPを指定しても緩和されない。 */
export function inertReportHtml(html: string): string {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">${html.replace(/^\s*<!doctype[^>]*>/i, '')}`;
}

/** ユーザーデータと独立した、ネットワークもJavaScriptも使わない印刷専用窓。 */
async function reportPdf(html: string): Promise<Uint8Array> {
  const temp = await mkdtemp(join(tmpdir(), 'ojt-result-'));
  let window: BrowserWindow | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const source = join(temp, 'report.html');
    await writeFile(source, html, 'utf8');
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        javascript: false,
        webSecurity: true,
        webviewTag: false,
        allowRunningInsecureContent: false,
        partition: `ojt-result-${randomUUID()}`,
      },
    });
    const printWindow = window;
    const contents = printWindow.webContents;
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.webRequest.onBeforeRequest((request, callback) => {
      callback({ cancel: request.url !== pathToFileURL(source).href });
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    const render = async (): Promise<Uint8Array> => {
      await printWindow.loadFile(source);
      return contents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: 'A4',
        generateTaggedPDF: true,
      });
    };
    return await Promise.race([
      render(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error('Report timed out'), { code: 'ETIMEDOUT' }));
        }, REPORT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (window !== undefined && !window.isDestroyed()) window.destroy();
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/** 保存先・回数・成績の履歴は保持しない。キャンセルでは一時ファイルも作らない。 */
export async function exportResult(
  parent: BrowserWindow | undefined,
  raw: unknown,
): Promise<ResultExportResult> {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, message: MSG.resultExport.invalid };
  }
  const request = raw as Partial<ResultExportRequest>;
  if (
    typeof request.html !== 'string' ||
    typeof request.suggestedName !== 'string' ||
    request.suggestedName.length > 180 ||
    safeFileName(request.suggestedName) !== request.suggestedName ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(request.suggestedName) ||
    !/\.pdf$/i.test(request.suggestedName)
  ) {
    return { ok: false, message: MSG.resultExport.invalid };
  }
  if (Buffer.byteLength(request.html, 'utf8') > MAX_REPORT_BYTES) {
    return { ok: false, message: MSG.textFile.tooLarge };
  }
  if (exporting) return { ok: false, message: MSG.resultExport.busy };
  exporting = true;
  try {
    const options = {
      title: MSG.resultExport.saveTitle,
      defaultPath: join(app.getPath('documents'), request.suggestedName),
      filters: [
        { name: MSG.resultExport.pdfFilter, extensions: ['pdf'] },
        { name: MSG.resultExport.htmlFilter, extensions: ['html'] },
      ],
    };
    const picked =
      parent === undefined
        ? await dialog.showSaveDialog(options)
        : await dialog.showSaveDialog(parent, options);
    if (picked.canceled || picked.filePath === undefined) return { ok: true, canceled: true };
    const extension = extname(picked.filePath).toLowerCase();
    if (extension !== '.pdf' && extension !== '.html' && extension !== '') {
      return { ok: false, message: MSG.resultExport.extension };
    }
    const target = extension === '' ? `${picked.filePath}.pdf` : picked.filePath;
    const html = inertReportHtml(request.html);
    writeFileAtomic(target, extension === '.html' ? html : await reportPdf(html));
    return { ok: true, canceled: false };
  } catch (cause) {
    return { ok: false, message: saveFailedText(errnoText(cause)) };
  } finally {
    exporting = false;
  }
}
