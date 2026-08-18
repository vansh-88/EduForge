import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { PORT } from './config/env.js';

const startServer = async () => {
  await connectDB();
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();