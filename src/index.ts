import dotenv from "dotenv";
import logger from "./config/logger";
import { shutdown } from "./services";
import app from "./app";
import { initAgent } from "./Agent/index";
import runInstagram from "./client/Instagram";

dotenv.config();

async function startServer() {
  try {
    await initAgent();

    // Get command line arguments
    const args = process.argv.slice(2);
    
    // Check if Instagram credentials are provided
    if (args.length >= 2 && args[0] === '--instagram') {
      const [_, username, password] = args;
      if (!username || !password) {
        logger.error("Please provide both username and password");
        process.exit(1);
      }
      
      logger.info(`Starting Instagram bot with account: ${username}`);
      await runInstagram({ username, password });
    } else {
      // Start the web server
      const server = app.listen(process.env.PORT || 3000, () => {
        logger.info(`Server is running on port ${process.env.PORT || 3000}`);
      });

      process.on("SIGTERM", () => {
        logger.info("Received SIGTERM signal.");
        shutdown(server);
      });
      
      process.on("SIGINT", () => {
        logger.info("Received SIGINT signal.");
        shutdown(server);
      });
    }
  } catch (err) {
    logger.error("Error during initialization:", err);
    process.exit(1);
  }
}

startServer();
