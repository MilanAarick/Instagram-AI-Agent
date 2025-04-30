import { GoogleGenerativeAI } from "@google/generative-ai";
import logger from "../config/logger";
import { geminiApiKeys } from "../secret";
import { handleError } from "../utils";
import { InstagramCommentSchema } from "./schema";
import fs from "fs";
import path from "path";
import * as readlineSync from "readline-sync";
import ApiKeyManager from "../config/apiKeyManager";

// Initialize the API key manager as a singleton
const apiKeyManager = new ApiKeyManager(geminiApiKeys);

export async function runAgent(schema: InstagramCommentSchema, prompt: string): Promise<any> {
    let geminiApiKey = apiKeyManager.getCurrentKey();

    if (!geminiApiKey) {
        logger.error("No Gemini API key available.");
        return "No API key available.";
    }

    const generationConfig = {
        responseMimeType: "application/json",
        responseSchema: schema,
    };

    const googleAI = new GoogleGenerativeAI(geminiApiKey);
    const model = googleAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig,
    });

    try {
        const result = await model.generateContent(prompt);
        apiKeyManager.markKeyUsed(); // Mark the current key as used

        if (!result || !result.response) {
            logger.info("No response received from the AI model. || Service Unavailable");
            return "Service unavailable!";
        }

        const responseText = result.response.text();
        const data = JSON.parse(responseText);

        return data;
    } catch (error) {
        if (error instanceof Error) {
            if (error.message.includes("429 Too Many Requests")) {
                // Get the next available API key
                geminiApiKey = apiKeyManager.getNextKey();
                const status = apiKeyManager.getKeyStatus();
                logger.info(`Switched to API key ${status.currentKey}/${status.totalKeys} (Usage: ${status.usageCount})`);
                
                // Retry with the new key
                return runAgent(schema, prompt);
            } else if (error.message.includes("503 Service Unavailable")) {
                logger.error("Service is temporarily unavailable. Retrying...");
                await new Promise(resolve => setTimeout(resolve, 5000));
                return runAgent(schema, prompt);
            } else {
                logger.error(`Error generating content: ${error.message}`);
                return `An error occurred: ${error.message}`;
            }
        } else {
            logger.error("An unknown error occurred:", error);
            return "An unknown error occurred.";
        }
    }
}

export function chooseCharacter(): any {
    const charactersDir = (() => {
        const buildPath = path.join(__dirname, "characters");
        if (fs.existsSync(buildPath)) {
            return buildPath;
        } else {
            // Fallback to source directory
            return path.join(process.cwd(), "src", "Agent", "characters");
        }
    })();
    const files = fs.readdirSync(charactersDir);
    const jsonFiles = files.filter(file => file.endsWith(".json"));
    if (jsonFiles.length === 0) {
        throw new Error("No character JSON files found");
    }
    console.log("Select a character:");
    jsonFiles.forEach((file, index) => {
        console.log(`${index + 1}: ${file}`);
    });
    const answer = readlineSync.question("Enter the number of your choice: ");
    const selection = parseInt(answer);
    if (isNaN(selection) || selection < 1 || selection > jsonFiles.length) {
        throw new Error("Invalid selection");
    }
    const chosenFile = path.join(charactersDir, jsonFiles[selection - 1]);
    const data = fs.readFileSync(chosenFile, "utf8");
    const characterConfig = JSON.parse(data);
    return characterConfig;
}

export function initAgent(): any {
    try {
        const character = chooseCharacter();
        console.log("Character selected:", character);
        return character;
    } catch (error) {
        console.error("Error selecting character:", error);
        process.exit(1);
    }
}

if (require.main === module) {
    (() => {
        initAgent();
    })();
}
