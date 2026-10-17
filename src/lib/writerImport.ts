// Import to Agentic Writer (docs/content-v2.md): the contract between the Editorial Calendar and the writer.
// Importing a piece sets calendar_items.extra.in_writer_at to the time it was imported, merged into extra.
// Its status stays as it was. Week 1's Write now kept extra.write_queued_at; that counts as imported too.
// Shared by the server and the browser.

type Extra = Record<string, string | number | null> | undefined;
type Piece = { status: string; extra?: Extra };

/** When the piece went into the Agentic Writer, or null if it hasn't. */
export function inWriterAt(item: { extra?: Extra }): string | null {
  const at = item.extra?.in_writer_at ?? item.extra?.write_queued_at;
  return typeof at === "string" && at ? at : null;
}

/** A published piece, or one already in the writer, has nothing to import. */
export const canImport = (item: Piece) => item.status !== "published" && !inWriterAt(item);

/** The change that imports a piece: extra with in_writer_at merged in. Nothing else changes. */
export function importPatch(item: { extra?: Extra }, at: string): { extra: Record<string, string | number | null> } {
  return { extra: { ...(item.extra ?? {}), in_writer_at: at } };
}
