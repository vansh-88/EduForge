import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

if (!MONGO_URI) {
    throw new Error('MONGO_URI is not defined');
}

export { PORT, MONGO_URI, CORS_ORIGIN };
