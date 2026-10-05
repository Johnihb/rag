/**
 * Admin-only PDF upload.
 *
 * Saves the file to ./uploads and indexes it into Pinecone. Indexing happens
 * inline, so the browser waits for the response. That is slow (embedding every
 * chunk takes a while) but it keeps this file to one straightforward path with
 * no job ids, no polling, and no background state.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { indexTheDocument } from "./prepare.js"; 

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

// A PDF this size is already unreasonable for a chat knowledge base.
export const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20mb

/**
 * Clean up the filename the browser sent.
 * Strips any path segments so a name like "../../server.js" cannot write
 * outside ./uploads, then forces a .pdf extension.
 */
function safeFilename(raw) {
  const base = path.basename(String(raw || "")).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${(base.replace(/\.pdf$/i, "") || "document").slice(0, 80)}.pdf`;
}

/** POST /api/uploads  (admin only) — raw application/pdf body. */
export async function uploadPdf(req, res) {
  // express.raw() gives us the file bytes as a Buffer.
  const buffer = req.body;

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return res.status(400).json({ error: "No file received" });
  }

  // Check the file itself, not the content type the browser claimed.
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return res.status(400).json({ error: "That file is not a PDF" });
  }

  if (buffer.length > MAX_PDF_BYTES) {
    return res.status(413).json({ error: "PDF is larger than 20mb" });
  }

  const filename = safeFilename(req.query.filename);
  const filePath = path.join(UPLOAD_DIR, filename);

  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(filePath, buffer);
    await indexTheDocument(filePath);

    res.json({ filename });
  } catch (error) {
    console.error("Upload failed:", error);
    res.status(500).json({ error: error.message || "Upload failed" });
  }
}
