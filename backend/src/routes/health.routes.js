import { Router } from 'express';
import mongoose from 'mongoose';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running and healthy',
  });
});

//to check if mongoDB is connected and ready to accept requests
healthRouter.get('/ready', (req, res) => {
  const dbState = mongoose.connection.readyState;
  if (dbState === 1) {
    res.status(200).json({
      success: true,
      message: 'MongoDB is connected and ready',
    });
  } else {
    res.status(503).json({
      success: false,
      message: 'MongoDB is not ready',
    });
  }
});
