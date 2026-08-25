import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { router } from './routes/routes.js';
import { CORS_ORIGIN } from './config/env.config.js';
import {errorHandler} from './middlewares/error.middleware.js';

export const createApp = () => {

  const app = express();

  const corsOptions = {
    origin: CORS_ORIGIN,
    // Without this the browser cannot read the header, even though we send it — so the
    // frontend would be unable to tell a replayed mutation from a fresh one.
    exposedHeaders: ['X-Idempotency-Replayed'],
  };

  app.use(helmet());
  app.use(cors(corsOptions));

  // Explicit rather than relying on the 100kb default. Image uploads go straight to
  // Cloudinary, so no request to this API should ever be large.
  app.use(express.json({ limit: '100kb' }));

  app.use('/api',router);

  //global error handler
  app.use(errorHandler);

  return app;
}


