import readLine from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { vectorStore } from "./prepare.js";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";

const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  temperature: 0.75,
  apiKey: process.env.GEMINI_API_KEY,
});

const SYSTEM_PROMPT = `You are the support assistant for {COMPANY_NAME}. You answer questions about the company using the reference material below.

Reference material:
{context}

How to answer:
- Use only the reference material. If a fact is not there, do not guess or fill the gap from general knowledge.
- Speak as the company would, in a warm, polite, plain tone. Refer to the company as "we" and "our".
- Give the answer directly. Never say things like "based on the context", "the provided information", "the documents say", or "according to my data".
- Headings, titles, and section names in the material count as information. If the question asks for a name, title, or list of topics, answer from them.
- If the material covers only part of the question, answer that part and say plainly that you don't have the rest.
- Keep answers short. Use a list only when the user asks for several items.

When the answer is missing:
Reply in a polite, apologetic tone, and suggest rephrasing or contacting the team. Vary the wording. Example:
"I couldn't find that in the information I have. Could you try rephrasing your question, or contact us directly for help?"

If someone sincerely asks whether they are talking to a person or an AI, say you are the company's virtual assistant.`;
/**
 * Answers a single question using the RAG pipeline.
 * @param {string} question
 * @param {{ history?: Array<{ role: "user" | "assistant", content: string }>, k?: number }} [options]
 * @returns {Promise<string>}
 */
export async function askQuestion(question, options = {}) {
  const { history = [], k = 3 } = options;

  // * Step 5:Retrieval
  const relevantChunks = await vectorStore.similaritySearch(question, k); // k is the number of docs to retrieve
  const context = relevantChunks.map((chunk) => chunk.pageContent).join("\n\n");

  const userQuery = `Question: ${question}

Context:${context}

Answer: `;

  const historyMessages = history.map((turn) =>
    turn.role === "assistant"
      ? new AIMessage(turn.content)
      : new HumanMessage(turn.content),
  );

  const completion = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...historyMessages,
    new HumanMessage(userQuery),
  ]);

  return completion.text;
}

export async function chat() {
  const rl = readLine.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const history = [];

  try {
    while (true) {
      const question = (await rl.question("You: ")).trim();

      if (!question) continue;
      if (question === "exit" || question === "/bye") break;

      const answer = await askQuestion(question, { history });
      history.push({ role: "user", content: question });
      history.push({ role: "assistant", content: answer });

      console.log(`AI: ${answer}`);
    }
  } catch (error) {
    console.error(error);
  } finally {
    rl.close();
  }
}

// Only run the terminal loop when this file is executed directly.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  chat();
}
