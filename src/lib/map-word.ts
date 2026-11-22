const PAGE_W_MM = 210;
const PAGE_H_MM = 297;

export async function downloadMapWord(png: Blob, fileBase: string) {
  const {
    convertMillimetersToTwip,
    Document,
    HorizontalPositionRelativeFrom,
    ImageRun,
    Packer,
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
              width: convertMillimetersToTwip(PAGE_W_MM),
              height: convertMillimetersToTwip(PAGE_H_MM),
            },
            margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 },
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
                  width: px(PAGE_W_MM),
                  height: px(PAGE_H_MM),
                },
                floating: {
                  horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
                  verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
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

export async function downloadMapPdf(png: Blob, fileBase: string) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  pdf.addImage(await blobToDataUrl(png), 'PNG', 0, 0, PAGE_W_MM, PAGE_H_MM);
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
