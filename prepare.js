import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";

import "dotenv/config";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

//*step 3:Embeddings
const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-2",
  apiKey: process.env.GEMINI_API_KEY,
});

// *step 4:Store/database(Pinecone)
const pinecone = new PineconeClient({
  apiKey: process.env.PINECONE_API_KEY,
});
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);
export const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
  pineconeIndex,
  maxConcurrency: 5,
});

export async function indexTheDocument(filePath) {
  //*step 1:laoding the documents
  const loader = new PDFLoader(filePath, { splitPages: false });
  const document = await loader.load(); //each page is assigned to a document key
  // console.log(document[0].pageContent);

  //*step 2:Chunking
  const textSplitter = new RecursiveCharacterTextSplitter({
    //split the document into chunks based on the character length
    chunkSize: 500,
    chunkOverlap: 100, //number of characters to overlap between chunks
  });

  const texts = await textSplitter.splitText(document[0].pageContent);

  const documents = texts.map((chunk) => ({
    pageContent: chunk,
    metadata: document[0].metadata,
  }));

  const store = vectorStore;

  console.log("document uploading....")
  
  try{
    await store.addDocuments(documents)
    console.log("document uploaded")
  }catch(error){
    console.log(error)

  }
}
