import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { healthRouter } from './routes/health.routes.js';

export const createApp = () => {

  const app = express();
  dotenv.config();

  app.use(cors());
  app.use(express.json());

  app.use(healthRouter);

  return app;
} 


