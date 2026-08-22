import { createApp } from './app.js';
import { PORT } from './config/env.config.js';
import { connectDB } from './config/db.config.js';

const startServer = async () => {
  await connectDB();
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();