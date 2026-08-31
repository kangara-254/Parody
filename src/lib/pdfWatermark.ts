import jsPDF from "jspdf";

// Faint, tone-on-tone crest watermark shared by every jsPDF export
// (report forms + both analysis PDFs) so the brand mark stays
// consistent across all of them without duplicating the drawing code
// in each file.
//
// Drawn AFTER a page's content (not behind it) at very low opacity.
// That's the opposite of layering order a print watermark usually
// implies, but it's the more robust choice here: autoTable cells
// often paint solid fill colors (header bars, level-color cells, the
// footer row), and a watermark placed behind that content would be
// invisible wherever a filled cell sits on top of it. Placing it last
// with low opacity keeps it visibly present everywhere, including
// under filled cells, while staying subtle enough not to interfere
// with reading the content.
function drawWatermarkOnCurrentPage(
  doc: jsPDF,
  imageDataUrl: string,
  opts?: { opacity?: number; widthFrac?: number; aspect?: number }
) {
  const opacity = opts?.opacity ?? 0.06;
  const widthFrac = opts?.widthFrac ?? 0.5;
  const aspect = opts?.aspect ?? 0.844; // matches the crest asset used elsewhere in these exports

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const w = pageW * widthFrac;
  const h = w / aspect;
  const x = (pageW - w) / 2;
  const y = (pageH - h) / 2;

  const gState = new (doc as any).GState({ opacity });
  doc.saveGraphicsState();
  doc.setGState(gState);
  doc.addImage(imageDataUrl, "PNG", x, y, w, h);
  doc.restoreGraphicsState();
}

// Applies the watermark to every page currently in the document. Call
// this LAST -- after all content, including any addPage() calls made
// while laying out that content -- so pages added partway through
// (e.g. the analysis PDF's overview-overflow safety net) get one too.
export function watermarkAllPages(
  doc: jsPDF,
  imageDataUrl: string | null,
  opts?: { opacity?: number; widthFrac?: number; aspect?: number }
) {
  if (!imageDataUrl) return; // watermark is decorative -- skip quietly if the crest failed to load
  const pageCount = doc.getNumberOfPages();
  const currentPage = (doc as any).internal.getCurrentPageInfo?.().pageNumber ?? pageCount;
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    drawWatermarkOnCurrentPage(doc, imageDataUrl, opts);
  }
  doc.setPage(currentPage);
}
