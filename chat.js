import readLine from "node:readline/promises";
import { ChatGoogle } from "@langchain/google";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { vectorStore } from "./prepare.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  temperature: 0.75,
  apiKey: process.env.GEMINI_API_KEY,
});

const SYSTEM_PROMPT = `You are an assistant for a company. You can answer questions about the company.You are provided with context along with the user question 
### Warning: 
 -Do not make up answers. Use the provided context to answer the question.You are forbidden to make up answers. Use the provided context to answer the question.
 When answering the question, you are forbidden  language like based on your context , the provided context  or anything that makes suspicious that you are some kind of AI , rather As of the company records and policy`;

export async function chat() {
  const rl = readLine.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  while (true) {
    const question = await rl.question("You: ");

    if (question === "exit" || question === "/bye") {
      break;
    }

    // * Step 5:Retrival
    const relevantChunks = await vectorStore.similaritySearch(question, 3); //2 is the number of docs to retrieve i.e k

    const context = await relevantChunks
      .map((chunk) => chunk.pageContent)
      .join("\n\n");

    const userQuery = `Question: ${question}

Context:${context}

Answer: `;

    const completion = await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(userQuery),
    ]);

    console.log(`AI: ${completion.text}`);
  }

  rl.close();
}

chat();
