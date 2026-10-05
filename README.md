# 🧠 RAG — Retrieval-Augmented Generation with LangChain & Google Gemini

A lightweight yet powerful **Retrieval-Augmented Generation (RAG)** system built with **Node.js**, **LangChain**, **Google Gemini**, and **Pinecone**. Feed it a PDF document, ask it anything about it, and get grounded, accurate answers — no hallucinations, no guesswork.

---

## 📑 Table of Contents

- [Overview](#-overview)
- [How It Works](#-how-it-works)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Usage](#-usage)
- [Project Structure](#-project-structure)
- [Acknowledgements](#-acknowledgements)
- [Resources & Docs](#-resources--docs)
- [License](#-license)

---

## 🔍 Overview

This project implements a two-stage RAG pipeline:

| Stage | Description |
|-------|-------------|
| **Stage 1 — Indexing** | Load a PDF → Chunk it → Generate embeddings → Store in Pinecone vector DB |
| **Stage 2 — Querying** | User asks a question → Retrieve relevant chunks → Feed context + question to Gemini → Get a grounded answer |

The chat interface runs in the terminal and maintains a conversation loop until you type `exit` or `/bye`.

---

## ⚙️ How It Works

```
PDF Document
     │
     ▼
┌─────────────┐    ┌─────────────────────┐    ┌──────────────┐
│  PDF Loader │───▶│  Text Splitter      │───▶│  Embeddings  │
│ (LangChain) │    │  (500 char chunks,  │    │  (Gemini     │
│             │    │   100 overlap)      │    │  Embedding-2)│
└─────────────┘    └─────────────────────┘    └──────┬───────┘
                                                      │
                                                      ▼
                                              ┌───────────────┐
                                              │   Pinecone    │
                                              │  Vector Store │
                                              └──────┬────────┘
                                                     │
                    ┌───────────────────────────────▼──┐
                    │         User Query               │
                    │  Similarity Search (top-3 chunks)│
                    │  + System Prompt                 │
                    │  + Gemini 2.5 Flash Lite LLM     │
                    └──────────────────────────────────┘
                                     │
                                     ▼
                              Grounded Answer 🎯
```

---

## 🛠️ Tech Stack

| Technology | Role |
|------------|------|
| [Node.js](https://nodejs.org/) (ESM) | Runtime |
| [LangChain.js](https://js.langchain.com/) | RAG orchestration framework |
| [Google Gemini](https://ai.google.dev/) (`gemini-2.5-flash-lite`) | LLM for answer generation |
| [Google Gemini Embeddings](https://ai.google.dev/) (`gemini-embedding-2`) | Document & query embeddings |
| [Pinecone](https://www.pinecone.io/) | Vector database for similarity search |
| [pdf-parse](https://www.npmjs.com/package/pdf-parse) | PDF document loading |

---

## ✅ Prerequisites

Before running this project, make sure you have the following:

### Software
- **Node.js** `v18+` — [Download here](https://nodejs.org/en/download)
- **npm** `v9+` — Comes bundled with Node.js

### Accounts & API Keys
You will need active accounts and API keys from:

| Service | Purpose | Get It Here |
|---------|---------|-------------|
| **Google AI Studio** | Gemini LLM + Embeddings API | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **Pinecone** | Vector database to store embeddings | [pinecone.io](https://www.pinecone.io/) |

### Pinecone Index Setup
Before running, create a Pinecone index with the following settings:
- **Dimensions**: `3072` (matches `gemini-embedding-2` output size)
- **Metric**: `cosine`
- **Cloud/Region**: Choose any (e.g., `aws` / `us-east-1`)

> 💡 The free tier of Pinecone is sufficient to run this project.

### Conceptual Knowledge (Helpful)
Having a basic understanding of these topics will help you get the most from this project:
- What a **vector embedding** is
- How **cosine similarity** works
- The concept of **chunking** for text processing
- Basics of how **LLMs** generate text
- General familiarity with **async/await** in JavaScript

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/johnihb/rag.git
cd rag
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the root directory (see [Environment Variables](#-environment-variables) below).

### 4. Add your PDF

Place the PDF document you want to query in the root directory and update the file path in `rag.js`:

```js
// rag.js
const filePath = "./your-document.pdf";
```

### 5. Index the document

Run the indexing step to load, chunk, embed, and store your PDF in Pinecone:

```bash
npm run dev
```

> ⚠️ You only need to run this **once per document**. After indexing, the vectors are stored in Pinecone persistently. Comment out `store.addDocuments(documents)` in `prepare.js` after the first run to avoid duplicate entries.

### 6. Start chatting

```bash
npm run chat
```

Type your questions and press `Enter`. Type `exit` or `/bye` to quit.

### 7. Or use the web UI

```bash
npm run ui
```

Open `http://localhost:3000`. Same RAG pipeline, served as a chat interface on an
Express server (`server.js`), with a plain HTML/CSS/JS front end in `public/`
(no framework, no build step). Conversation history is kept, so follow-up
questions work. Set `PORT` in `.env` to change the port.

### 8. Sign in

The UI has two roles. Sign in with either set of static credentials:

| Role     | Username | Password | Can do                    |
|----------|----------|----------|---------------------------|
| `admin`  | `admin`  | `admin`  | Chat **and** upload PDFs   |
| `user`   | `user`   | `user`   | Chat only                  |

Admins see a **Documents** panel above the chat with a file picker. Choosing a
PDF uploads it to `./uploads`, and the server chunks and embeds it into Pinecone
before replying. One request, no polling — the browser waits, which for a large
file can take tens of seconds.

> ⚠️ These credentials are hardcoded in `auth.js` and sessions live in memory.
> That is fine for a local tool and **not** safe on a shared host or the public
> internet. See the warning at the top of `auth.js` for what to change first.

### API

| Method | Route              | Auth  | Body / Notes                                    | Response            |
|--------|--------------------|-------|-------------------------------------------------|---------------------|
| `POST` | `/api/login`       | –     | `{ username, password }`                        | `{ user }`          |
| `POST` | `/api/logout`      | –     | –                                               | `{ ok: true }`      |
| `GET`  | `/api/me`          | –     | –                                               | `{ user \| null }`  |
| `POST` | `/api/chat`        | any   | `{ question, history? }`                        | `{ answer }`        |
| `POST` | `/api/uploads`     | admin | Raw `application/pdf` body, `?filename=`        | `{ filename }`      |
| `GET`  | `/api/health`      | –     | –                                               | `{ status: "ok" }`  |

Upload rules: 20mb maximum, PDF magic bytes checked, filenames sanitised, and
re-uploading the same name overwrites the previous file. A PDF with no
extractable text (a scan with no OCR layer) is rejected with a readable message
rather than an internal error.

---

## 🔐 Environment Variables

Create a `.env` file in the project root with the following keys:

```env
GEMINI_API_KEY=your_google_gemini_api_key_here
PINECONE_API_KEY=your_pinecone_api_key_here
PINECONE_INDEX_NAME=your_pinecone_index_name_here
```

> 🔒 **Never commit your `.env` file to version control.** It is already listed in `.gitignore`.

---

## 💬 Usage

```
$ npm run chat

You: What is the company's refund policy?
AI: According to company records, refunds are processed within 7–10 business days...

You: Who is the CEO?
AI: As per company policy documentation, the CEO is...

You: exit
```

The assistant is instructed to **only answer from the provided document context** and avoid making up information.

---

## 📁 Project Structure

```
rag/
├── prepare.js        # Stage 1: Load, chunk, embed, and store PDF in Pinecone
├── chat.js           # Stage 2: Query loop — retrieve context and call Gemini LLM
├── server.js         # Express server — routes, static UI, auth wiring
├── auth.js           # Static credentials, in-memory sessions, role guards
├── uploads.js        # Admin-only PDF upload and background indexing
├── public/           # Chat UI (index.html, styles.css, app.js, markdown.js)
├── uploads/          # PDFs uploaded by admins (gitignored)
├── rag.js            # Entry point — triggers the indexing pipeline
├── test.pdf          # Sample PDF document (replace with your own)
├── package.json      # Project metadata and dependencies
├── .env              # API keys (NOT committed to git)
├── .gitignore        # Ignores node_modules and .env
└── README.md         # You are here
```

---

## 🙏 Acknowledgements

- **[Google Gemini](https://ai.google.dev/)** — Thanks to Google for providing the powerful Gemini API, which powers both the embedding generation (`gemini-embedding-2`) and the language model (`gemini-2.5-flash-lite`) used in this project. The free tier made development accessible and fast.

- **[LangChain](https://js.langchain.com/)** — The backbone of this project's RAG pipeline. LangChain's abstractions for document loaders, text splitters, vector stores, and LLM chains made building this system significantly easier.

- **[Pinecone](https://www.pinecone.io/)** — For providing a fast and developer-friendly managed vector database that seamlessly integrates with LangChain.

---

## 📚 Resources & Docs

| Resource | Link |
|----------|------|
| 📖 LangChain JS Docs (RAG) | [js.langchain.com/docs/tutorials/rag](https://js.langchain.com/docs/tutorials/rag/) |
| 📖 LangChain Text Splitters | [js.langchain.com/docs/concepts/text_splitters](https://js.langchain.com/docs/concepts/text_splitters/) |
| 📖 LangChain Vector Stores | [js.langchain.com/docs/concepts/vectorstores](https://js.langchain.com/docs/concepts/vectorstores/) |
| 🤖 Google Gemini API Docs | [ai.google.dev/gemini-api/docs](https://ai.google.dev/gemini-api/docs) |
| 🌲 Pinecone Docs | [docs.pinecone.io](https://docs.pinecone.io/) |
| 📦 LangChain Pinecone Integration | [js.langchain.com/docs/integrations/vectorstores/pinecone](https://js.langchain.com/docs/integrations/vectorstores/pinecone/) |

> For a comprehensive deep-dive into building RAG systems with LangChain, visit the **[official LangChain RAG documentation](https://js.langchain.com/docs/tutorials/rag/)**.

---



---

<div align="center">
  <sub>Built with ❤️ using LangChain.js · Google Gemini · Pinecone</sub>
</div>
