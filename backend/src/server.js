import { createApp } from './app.js';
import { connectDB, PORT} from './config/index.js';

const startServer = async () => {
  await connectDB();
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();