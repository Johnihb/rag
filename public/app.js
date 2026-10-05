/**
 * Chat UI controller.
 *
 * Two views live in index.html: a sign-in form and the chat shell. On load we
 * ask the server who we are (/api/me). A session cookie decides which view is
 * shown, and every API call carries that cookie automatically.
 */

import { renderMarkdown } from "./markdown.js";

/* ------------------------------------------------------------------ */
/* Element references                                                  */
/* ------------------------------------------------------------------ */

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");

const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

const userBadge = document.getElementById("userBadge");
const logoutBtn = document.getElementById("logoutBtn");
const clearBtn = document.getElementById("clearBtn");

const adminPanel = document.getElementById("adminPanel");
const uploadForm = document.getElementById("uploadForm");
const pdfInput = document.getElementById("pdfInput");
const uploadBtn = document.getElementById("uploadBtn");
const uploadStatus = document.getElementById("uploadStatus");

const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

const GREETING = "Ask me anything about the company. I answer only from the indexed documents.";

/** Last 20 messages, trimmed client-side. The server trims again to 10. */
let history = [];

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** POST JSON and surface the server's error message on failure. */
async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

  return data;
}

/** Disable the input while a question is in flight. */
function setBusy(value) {
  sendBtn.disabled = value;
  messageInput.disabled = value;
  if (!value) messageInput.focus();
}

function scrollToBottom() {
  chatLog.scrollTop = chatLog.scrollHeight;
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

/**
 * Add one message bubble.
 * @param {"user" | "bot"} role
 * @param {string} text
 * @param {{ variant?: string, markdown?: boolean }} [options]
 *   markdown - render as markdown. Bot replies only; user input stays verbatim
 *   so any asterisks they typed remain visible.
 */
function addMessage(role, text, { variant = "", markdown = false } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = `message message--${role}${variant ? ` ${variant}` : ""}`;

  const author = document.createElement("div");
  author.className = "message__author";
  author.textContent = role === "user" ? "You" : "Assistant";

  const body = document.createElement("div");
  body.className = "message__body";

  if (markdown) {
    body.classList.add("message__body--rich");
    body.append(renderMarkdown(text));
  } else {
    body.textContent = text;
  }

  wrapper.append(author, body);
  chatLog.append(wrapper);
  scrollToBottom();
}

function showTyping() {
  const wrapper = document.createElement("div");
  wrapper.className = "message message--bot";
  wrapper.id = "typingIndicator";

  const author = document.createElement("div");
  author.className = "message__author";
  author.textContent = "Assistant";

  const body = document.createElement("div");
  body.className = "message__body";
  body.innerHTML =
    '<div class="typing" role="status" aria-label="Assistant is typing"><span></span><span></span><span></span></div>';

  wrapper.append(author, body);
  chatLog.append(wrapper);
  scrollToBottom();
}

function removeTyping() {
  document.getElementById("typingIndicator")?.remove();
}

function resetChat() {
  history = [];
  chatLog.replaceChildren();
  addMessage("bot", GREETING);
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

async function ask(question) {
  setBusy(true);
  addMessage("user", question);
  showTyping();

  try {
    const { answer } = await postJson("/api/chat", { question, history });

    const text = answer?.trim() || "I could not find an answer in the indexed documents.";

    history.push({ role: "user", content: question }, { role: "assistant", content: text });
    if (history.length > 20) history = history.slice(-20);

    removeTyping();
    addMessage("bot", text, { markdown: true });
  } catch (error) {
    removeTyping();

    // A 401 means the session expired while the page was open.
    if (error.message === "Not signed in") {
      showLogin("Your session expired. Sign in again.");
      return;
    }

    addMessage("bot", error.message, { variant: "message--error" });
  } finally {
    setBusy(false);
  }
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const question = messageInput.value.trim();
  if (!question) return;

  messageInput.value = "";
  ask(question);
});

clearBtn.addEventListener("click", () => {
  resetChat();
  messageInput.focus();
});

/* ------------------------------------------------------------------ */
/* Upload (admin only)                                                 */
/* ------------------------------------------------------------------ */

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = pdfInput.files?.[0];
  if (!file) {
    showUploadStatus("Choose a PDF first.", "error");
    return;
  }

  uploadBtn.disabled = true;
  showUploadStatus(`Uploading and indexing ${file.name}...`, "working");

  try {
    // The file is the request body. The server saves it, indexes it, and only
    // then replies, so this one request covers the whole thing.
    const response = await fetch(`/api/uploads?filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Upload failed (${response.status})`);
    }

    pdfInput.value = "";
    showUploadStatus(`Indexed ${data.filename}. Ask a question to test it.`, "done");
  } catch (error) {
    showUploadStatus(error.message, "error");
  } finally {
    uploadBtn.disabled = false;
  }
});

function showUploadStatus(message, kind = "") {
  uploadStatus.textContent = message;
  uploadStatus.className = `admin__status${kind ? ` admin__status--${kind}` : ""}`;
  uploadStatus.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Auth flow                                                           */
/* ------------------------------------------------------------------ */

function showLogin(message = "") {
  loginView.hidden = false;
  appView.hidden = true;

  loginError.textContent = message;
  loginError.hidden = !message;

  usernameInput.focus();
}

function showApp(user) {
  loginView.hidden = true;
  appView.hidden = false;

  userBadge.textContent = user.username;

  // The upload panel is the only admin-only piece of the UI.
  adminPanel.hidden = user.role !== "admin";

  messageInput.focus();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  loginBtn.disabled = true;
  loginError.hidden = true;

  try {
    const { user } = await postJson("/api/login", {
      username: usernameInput.value,
      password: passwordInput.value,
    });

    passwordInput.value = "";
    resetChat();
    showApp(user);
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await postJson("/api/logout", {});
  } catch {
    // Even if the server call fails, drop the local view.
  }

  history = [];
  usernameInput.value = "";
  showLogin("Signed out.");
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

// Restore the session on load. A valid cookie means we skip the login form.
(async function init() {
  try {
    const response = await fetch("/api/me");
    const { user } = await response.json();

    if (user) {
      resetChat();
      showApp(user);
    } else {
      showLogin();
    }
  } catch {
    showLogin("Could not reach the server.");
  }
})();
