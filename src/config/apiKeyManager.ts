import logger from './logger';

class ApiKeyManager {
    private apiKeys: string[];
    private currentIndex: number;
    private usageCount: Map<number, number>;
    private lastUsed: Map<number, Date>;
    private readonly resetThreshold: number = 60000; // 1 minute cooldown

    constructor(apiKeys: string[]) {
        this.apiKeys = apiKeys.filter(key => key && !key.startsWith('API_KEY_')); // Filter out default/placeholder keys
        this.currentIndex = 0;
        this.usageCount = new Map();
        this.lastUsed = new Map();
        
        // Initialize usage counts and timestamps
        this.apiKeys.forEach((_, index) => {
            this.usageCount.set(index, 0);
            this.lastUsed.set(index, new Date(0));
        });

        if (this.apiKeys.length === 0) {
            throw new Error('No valid API keys provided');
        }
    }

    private shouldResetUsage(index: number): boolean {
        const lastUsedTime = this.lastUsed.get(index);
        if (!lastUsedTime) return true;

        const now = new Date();
        return now.getTime() - lastUsedTime.getTime() >= this.resetThreshold;
    }

    private resetUsage(index: number): void {
        this.usageCount.set(index, 0);
        this.lastUsed.set(index, new Date());
    }

    public getCurrentKey(): string {
        return this.apiKeys[this.currentIndex];
    }

    public getNextKey(): string {
        const startIndex = this.currentIndex;
        let attempts = 0;

        do {
            // Move to next key
            this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
            
            // Reset usage if cooldown period has passed
            if (this.shouldResetUsage(this.currentIndex)) {
                this.resetUsage(this.currentIndex);
            }

            // If we've tried all keys, reset the first available one
            attempts++;
            if (attempts >= this.apiKeys.length) {
                logger.warn('All API keys have been recently used. Resetting the first available key.');
                this.resetUsage(this.currentIndex);
                break;
            }
        } while (
            // Keep looking if current key is exhausted and we haven't tried all keys
            (this.usageCount.get(this.currentIndex) || 0) >= 60 && // Assuming 60 requests per minute limit
            this.currentIndex !== startIndex
        );

        const keyNumber = this.currentIndex + 1;
        logger.info(`Switching to GEMINI_API_KEY_${keyNumber}`);
        return this.apiKeys[this.currentIndex];
    }

    public markKeyUsed(): void {
        const currentUsage = this.usageCount.get(this.currentIndex) || 0;
        this.usageCount.set(this.currentIndex, currentUsage + 1);
        this.lastUsed.set(this.currentIndex, new Date());

        // If current key is exhausted, get next key
        if (currentUsage + 1 >= 60) { // Assuming 60 requests per minute limit
            logger.warn(`GEMINI_API_KEY_${this.currentIndex + 1} limit reached (${currentUsage + 1} requests). Switching to next key.`);
            this.getNextKey();
        }
    }

    public getKeyStatus(): { currentKey: number; usageCount: number; totalKeys: number } {
        return {
            currentKey: this.currentIndex + 1,
            usageCount: this.usageCount.get(this.currentIndex) || 0,
            totalKeys: this.apiKeys.length
        };
    }
}

export default ApiKeyManager; 