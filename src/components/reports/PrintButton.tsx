"use client";

/** Opens the browser's print window, where the viewer can save the page as a PDF. */
export function PrintButton() {
  return (
    <button type="button" className="aw-btn aw-btn--primary aw-btn--sm print:hidden" onClick={() => window.print()}>
      Download PDF
    </button>
  );
}
