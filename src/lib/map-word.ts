const MARGIN_MM = 4;

export async function downloadMapWord(png: Blob, imageWidth: number, imageHeight: number, fileBase: string) {
  const { convertMillimetersToTwip, Document, ImageRun, LineRuleType, Packer, PageOrientation, Paragraph } = await import('docx');
  const ratio = imageWidth / Math.max(1, imageHeight);
  const portrait = fit(210, 297, ratio);
  const landscape = fit(297, 210, ratio);
  const page = landscape.area > portrait.area ? landscape : portrait;
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(210),
              height: convertMillimetersToTwip(297),
              orientation: page.pageW > page.pageH ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
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
            spacing: {
              before: 0,
              after: 0,
              line: convertMillimetersToTwip(page.drawH),
              lineRule: LineRuleType.EXACT,
            },
            children: [
              new ImageRun({
                type: 'png',
                data: new Uint8Array(await png.arrayBuffer()),
                transformation: {
                  width: Math.round((page.drawW / 25.4) * 96),
                  height: Math.round((page.drawH / 25.4) * 96),
                },
                altText: { name: fileBase, title: fileBase, description: fileBase },
              }),
            ],
          }),
        ],
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileBase}.docx`;
  link.click();
  URL.revokeObjectURL(url);
}

function fit(pageW: number, pageH: number, ratio: number) {
  const innerW = pageW - MARGIN_MM * 2;
  const innerH = pageH - MARGIN_MM * 2;
  const height = Math.min(innerW / ratio, innerH);
  const width = height * ratio;
  return { pageW, pageH, drawW: width, drawH: height, area: width * height };
}
