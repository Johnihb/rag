/**
 * Web server for the RAG chatbot UI.
 *
 * Responsibilities:
 *   1. Serve the static front end from ./public
 *   2. Handle login/logout and gate routes by role (see auth.js)
 *   3. Expose POST /api/chat, which runs the RAG pipeline and returns an answer
 *   4. Accept PDF uploads from admins and index them into Pinecone
 *
 * Run with: npm run ui   (then open http://localhost:3000)
 *
 * Credentials are hardcoded in auth.js. This is a local tool, not a product.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import "dotenv/config";

import { askQuestion } from "./chat.js";
import { login, logout, me, requireAuth, requireAdmin } from "./auth.js";
import { uploadPdf, MAX_PDF_BYTES } from "./uploads.js";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

// Past messages forwarded to the model. 10 messages = 5 question/answer pairs.
const MAX_HISTORY_MESSAGES = 10;
const MAX_QUESTION_LENGTH = 1000;

const app = express();

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */

// Parse JSON bodies for the chat and login routes.
app.use(express.json({ limit: "1mb" }));

// Raw body for the upload route, so the PDF arrives as bytes rather than a
// base64 string in JSON. The limit matches uploads.js so a rejection happens
// in one place with a readable message.
app.use(express.raw({ type: "application/pdf", limit: MAX_PDF_BYTES }));

// Minimal request log so you can see what the UI is doing in the terminal.
app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Normalise the client-supplied history into the shape askQuestion expects.
 * Anything unexpected is dropped rather than rejected, so a malformed client
 * still gets an answer instead of an error.
 * @param {unknown} raw
 * @returns {{ role: "user" | "assistant", content: string }[]}
 */
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(
      (turn) =>
        turn &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string"
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((turn) => ({ role: turn.role, content: turn.content }));
}

/* ------------------------------------------------------------------ */
/* Auth routes                                                         */
/* ------------------------------------------------------------------ */

// These three are the only routes reachable without a session.
app.post("/api/login", login);
app.post("/api/logout", logout);
app.get("/api/me", me);

// Readiness probe. Public so it can be checked before signing in.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ------------------------------------------------------------------ */
/* Protected routes                                                     */
/* ------------------------------------------------------------------ */

/**
 * The chat endpoint. Any signed-in user, admin or not.
 * Body: { question: string, history?: Array<{role, content}> }
 * Returns: { answer: string }
 */
app.post("/api/chat", requireAuth, async (req, res) => {
  const { question, history } = req.body ?? {};

  // Validate the question before spending a Pinecone + Gemini round trip.
  const trimmed =
    typeof question === "string" ? question.trim().slice(0, MAX_QUESTION_LENGTH) : "";

  if (!trimmed) {
    return res.status(400).json({ error: "A question is required" });
  }

  try {
    const answer = await askQuestion(trimmed, { history: sanitizeHistory(history) });
    res.json({ answer });
  } catch (error) {
    // Log the real cause server-side; keep the response generic so we do not
    // leak API keys, stack traces, or provider internals to the browser.
    console.error("Chat error:", error);
    res.status(500).json({
      error: "Something went wrong while answering. Check that your .env keys are set.",
    });
  }
});

/* ---- Admin only: document ingestion ---- */

// Indexes the PDF before responding, so the client only needs one request.
app.post("/api/uploads", requireAuth, requireAdmin, uploadPdf);

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

// express.static handles index.html for "/", correct Content-Type per extension,
// caching headers, and range requests. The `index` option serves public/index.html.
app.use(express.static(PUBLIC_DIR, { index: "index.html" }));

// Anything unmatched is a bad URL. Sent as JSON so the client can surface it
// through the same error path as other failures.
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

/* ------------------------------------------------------------------ */
/* Error handling                                                      */
/* ------------------------------------------------------------------ */

// Catches anything thrown in a route above, including body-parser rejections.
// Must keep all four parameters for Express to recognise it as an error handler.
app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }

  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Internal server error" });
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

app.listen(PORT, () => {
  console.log(`Chatbot UI running at http://localhost:${PORT}`);
  console.log("Sign in as admin/admin to upload documents, or user/user to chat only.");
});
