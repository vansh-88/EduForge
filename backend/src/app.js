import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.routes.js';
import {CORS_ORIGIN} from './config/env.js';

export const createApp = () => {

  const app = express();

  const corsOptions = {
    origin: CORS_ORIGIN
  };

  app.use(cors(corsOptions));
  app.use(express.json())

  app.use('/api',healthRouter);

  return app;
} 


