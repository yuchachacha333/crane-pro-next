const PAGE_W_MM = 297;
const PAGE_H_MM = 210;
const MARGIN_MM = 5;

export const FRAME_W_MM = PAGE_W_MM - MARGIN_MM * 2;
export const FRAME_H_MM = PAGE_H_MM - MARGIN_MM * 2;

export async function downloadMapWord(png: Blob, fileBase: string) {
  const {
    convertMillimetersToTwip,
    Document,
    HorizontalPositionRelativeFrom,
    ImageRun,
    Packer,
    PageOrientation,
    Paragraph,
    TextWrappingType,
    VerticalPositionRelativeFrom,
  } = await import('docx');
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(PAGE_H_MM),
              height: convertMillimetersToTwip(PAGE_W_MM),
              orientation: PageOrientation.LANDSCAPE,
            },
            margin: {
              top: convertMillimetersToTwip(MARGIN_MM),
              bottom: convertMillimetersToTwip(MARGIN_MM),
              left: convertMillimetersToTwip(MARGIN_MM),
              right: convertMillimetersToTwip(MARGIN_MM),
              header: 0,
              footer: 0,
            },
          },
        },
        children: [
          new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [
              new ImageRun({
                type: 'png',
                data: new Uint8Array(await png.arrayBuffer()),
                transformation: {
                  width: px(FRAME_W_MM),
                  height: px(FRAME_H_MM),
                },
                floating: {
                  horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: emu(MARGIN_MM) },
                  verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: emu(MARGIN_MM) },
                  behindDocument: true,
                  allowOverlap: true,
                  wrap: { type: TextWrappingType.NONE },
                },
                altText: { name: fileBase, title: fileBase, description: fileBase },
              }),
            ],
          }),
        ],
      },
    ],
  });
  saveBlob(await Packer.toBlob(doc), `${fileBase}.docx`);
}

export async function downloadMapImage(png: Blob, fileBase: string) {
  const file = new File([png], `${fileBase}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: fileBase });
    return;
  }
  saveBlob(png, file.name);
}

export async function buildVisibleMapPdf(png: Blob, fileBase: string, widthPx: number, heightPx: number) {
  const { jsPDF } = await import('jspdf');
  const longSide = Math.max(widthPx, heightPx, 1);
  const mmPerPx = 280 / longSide;
  const pageW = widthPx * mmPerPx;
  const pageH = heightPx * mmPerPx;
  const pdf = new jsPDF({
    orientation: pageW >= pageH ? 'l' : 'p',
    unit: 'mm',
    format: [pageW, pageH],
  });
  pdf.addImage(await blobToDataUrl(png), 'PNG', 0, 0, pageW, pageH);
  const blob = pdf.output('blob');
  return new File([blob], `${fileBase}.pdf`, { type: 'application/pdf' });
}

export function saveNamedFile(blob: Blob, name: string) {
  saveBlob(blob, name);
}

export async function downloadMapPdf(png: Blob, fileBase: string) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
  pdf.addImage(await blobToDataUrl(png), 'PNG', MARGIN_MM, MARGIN_MM, FRAME_W_MM, FRAME_H_MM);
  const blob = pdf.output('blob');
  const file = new File([blob], `${fileBase}.pdf`, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: fileBase });
    return;
  }
  saveBlob(blob, file.name);
}

function px(mm: number) {
  return Math.round((mm / 25.4) * 96);
}

function emu(mm: number) {
  return Math.round((mm / 25.4) * 914400);
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
