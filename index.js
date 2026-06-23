/*
 * Implementation
 * Stage 1 : Indexing
 * 1:Load the documents-pdf,text 
 * 2:chunk the documents
 * 3:Generate embeddings for each chunk
 * 4:Store the embeddings in a database
 * 
 *
 * Stage 2 : Querying
 * 1:Setup LLM
 * 2:Add a retrieval step
 * 3:Pass input + relevent information to LLM
 * 4:output
*/