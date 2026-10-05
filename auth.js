/**
 * Authentication for the chat UI.
 *
 * ⚠️ READ THIS BEFORE DEPLOYING ANYWHERE PUBLIC
 *
 * This is deliberately the simplest thing that works for a local tool:
 * hardcoded plaintext credentials and sessions held in a Map that dies with
 * the process. That is fine while you are the only user on your own machine.
 * It is NOT safe on a shared host or the open internet, because:
 *   - the credentials are in the source file, readable by anyone with the repo
 *   - every restart logs everyone out
 *   - the session cookie is not marked secure, so it travels over plain http
 *
 * To make this real you would swap in bcrypt/argon2 hashes, a persistent store
 * (SQLite, Redis), and https-only secure cookies. The route guards and the
 * requireAuth/requireAdmin middleware below are the part that would stay.
 */

import crypto from "node:crypto";

/* ------------------------------------------------------------------ */
/* Credentials                                                         */
/* ------------------------------------------------------------------ */

/**
 * Static user list. Replace these before putting this on a network.
 * `admin` may upload and index documents; `user` may only chat.
 */
const USERS = [
  { username: "admin", password: "admin", role: "admin" },
  { username: "user", password: "user", role: "user" },
];

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

/**
 * sessionId -> { username, role, expiresAt }
 *
 * In-memory on purpose. No database, no signing secret, nothing on disk.
 * Entries are removed when they expire, but only when someone signs in again,
 * so a long-lived server accumulates a few dead tokens. Harmless locally.
 */
const sessions = new Map();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Parse a Cookie header into a plain object. Avoids a cookie-parser dependency. */
function parseCookies(header) {
  const jar = {};
  if (!header) return jar;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) jar[key] = decodeURIComponent(value);
  }

  return jar;
}

/** Look up the live session for a request, or null if absent/expired. */
function readSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

/** Send the session cookie. httpOnly keeps it away from page scripts. */
function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: false, // must stay false for plain http on localhost
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

/** Gate that requires any signed-in user. */
function requireAuth(req, res, next) {
  const session = readSession(req);

  if (!session) {
    return res.status(401).json({ error: "Not signed in" });
  }

  // Attach for downstream handlers so they do not re-parse the cookie.
  req.session = session;
  next();
}

/** Gate that requires the admin role. Must run after requireAuth. */
function requireAdmin(req, res, next) {
  if (req.session?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

/** POST /api/login { username, password } -> sets the session cookie. */
function login(req, res) {
  const { username, password } = req.body ?? {};

  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password are required" });
  }

  // Plain comparison. The credentials are hardcoded two functions above, so
  // there is nothing secret here for timing to leak.
  const match = USERS.find(
    (user) => user.username === username && user.password === password
  );

  if (!match) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    username: match.username,
    role: match.role,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  setSessionCookie(res, token);
  res.json({ user: { username: match.username, role: match.role } });
}

/** POST /api/logout -> clears the cookie and drops the session. */
function logout(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) sessions.delete(token);

  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
}

/** GET /api/me -> who am I, if anyone. Drives the UI on page load. */
function me(req, res) {
  const session = readSession(req);

  if (!session) {
    return res.json({ user: null });
  }
  res.json({ user: { username: session.username, role: session.role } });
}

export { login, logout, me, requireAuth, requireAdmin };
