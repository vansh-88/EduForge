import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_PROVIDER = process.env.AI_PROVIDER || 'gemini';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

if (!MONGO_URI) {
    throw new Error('MONGO_URI is not defined');
}
if(!GEMINI_API_KEY){
    throw new Error('gemini api key is not defined');
}

export { PORT, MONGO_URI, CORS_ORIGIN, GEMINI_API_KEY, AI_PROVIDER, GEMINI_MODEL };
