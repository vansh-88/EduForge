import express from 'express';
import cors from 'cors';
import { router } from './routes/routes.js';
import { CORS_ORIGIN } from './config/env.config.js';
import {errorHandler} from './middlewares/error.middleware.js';

export const createApp = () => {

  const app = express();

  const corsOptions = {
    origin: CORS_ORIGIN
  };

  app.use(cors(corsOptions));
  app.use(express.json())

  app.use('/api',router);

  //global error handler
  app.use(errorHandler);

  return app;
} 


