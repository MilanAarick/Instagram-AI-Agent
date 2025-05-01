import { Browser, DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import UserAgent from "user-agents";
import { Server } from "proxy-chain";
import { IGpassword, IGusername } from "../secret";
import logger from "../config/logger";
import { Instagram_cookiesExist, loadCookies, saveCookies } from "../utils";
import { runAgent } from "../Agent";
import { getInstagramCommentSchema } from "../Agent/schema";
import RateLimitTracker from "../config/rateLimit";
import fs from 'fs';
import path from 'path';

// Add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());
puppeteer.use(
    AdblockerPlugin({
        // Optionally enable Cooperative Mode for several request interceptors
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
);

interface InstagramCredentials {
    username: string;
    password: string;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Initialize rate limiter with account creation date
const rateLimiter = new RateLimitTracker(new Date()); // You should replace this with actual account creation date

// Add a Set to track commented posts (outside of functions to persist between iterations)
const commentedPosts = new Set<string>();

async function runInstagram(credentials?: InstagramCredentials) {
    const username = credentials?.username || IGusername;
    const password = credentials?.password || IGpassword;
    
    // Create cookies directory if it doesn't exist
    const cookiesDir = "./cookies";
    if (!fs.existsSync(cookiesDir)) {
        fs.mkdirSync(cookiesDir);
    }

    // Use account-specific cookie file
    const cookiesPath = path.join(cookiesDir, `instagram_${username}.json`);

    // Delete any existing cookies for this account
    if (fs.existsSync(cookiesPath)) {
        fs.unlinkSync(cookiesPath);
        logger.info(`Deleted existing cookies for account: ${username}`);
    }

    const server = new Server({ port: 8000 });
    await server.listen();
    const proxyUrl = `http://localhost:8000`;
    const browser = await puppeteer.launch({
        headless: false,
        args: [`--proxy-server=${proxyUrl}`],
    });

    const page = await browser.newPage();

    // Always perform fresh login with credentials
    await loginWithCredentials(page, browser, username, password, cookiesPath);

    // Take a screenshot after loading the page
    await page.screenshot({ path: `logged_in_${username}.png` });

    // Navigate to the Instagram homepage
    await page.goto("https://www.instagram.com/");

    // Continuously interact with posts without closing the browser
    while (true) {
        await interactWithPosts(page);
        logger.info("Iteration complete, waiting 30 seconds before refreshing...");
        await delay(30000);
        try {
            await page.reload({ waitUntil: "networkidle2" });
        } catch (e) {
            logger.warn("Error reloading page, continuing iteration: " + e);
        }
    }
}

const loginWithCredentials = async (page: any, browser: Browser, username: string, password: string, cookiesPath: string) => {
    try {
        await page.goto("https://www.instagram.com/accounts/login/");
        await page.waitForSelector('input[name="username"]');

        // Fill out the login form
        await page.type('input[name="username"]', username);
        await page.type('input[name="password"]', password);
        await page.click('button[type="submit"]');

        // Wait for navigation after login
        await page.waitForNavigation();

        // Save cookies after login
        const cookies = await browser.cookies();
        await saveCookies(cookiesPath, cookies);
        logger.info(`Saved new cookies for account: ${username}`);
    } catch (error) {
        logger.error(`Error logging in with credentials for account ${username}`);
        throw error;
    }
}

// Modify function signature to remove unused parameters
async function analyzePostContext(caption: string) {
    const context = {
        hasHashtags: caption.includes('#'),
        hasEmojis: /[\u{1F300}-\u{1F9FF}]/u.test(caption),
        isQuestion: caption.includes('?'),
        postType: 'general',
        tone: 'neutral',
        language: 'en' // Default to English, could be enhanced with language detection
    };

    // Detect post type
    if (caption.toLowerCase().includes('question') || context.isQuestion) {
        context.postType = 'question';
    } else if (caption.toLowerCase().includes('announcement') || caption.toLowerCase().includes('introducing')) {
        context.postType = 'announcement';
    }

    // Analyze tone
    const positiveWords = ['happy', 'excited', 'great', 'amazing', 'love', 'wonderful'];
    const negativeWords = ['sad', 'disappointed', 'unfortunate', 'sorry', 'bad'];
    const words = caption.toLowerCase().split(' ');
    
    if (positiveWords.some(word => words.includes(word))) {
        context.tone = 'positive';
    } else if (negativeWords.some(word => words.includes(word))) {
        context.tone = 'negative';
    }

    return context;
}

// Add function to construct contextual prompt
function constructContextualPrompt(caption: string, context: any) {
    let promptParts = [
        `Analyze and respond to this Instagram post: "${caption}"\n`,
        "Requirements:",
        "1. Response must be between 150-250 characters",
        "2. Must be relevant to the post's specific content",
        "3. Must comply with Instagram Community Standards",
        "4. Should feel natural and human-written",
    ];

    // Add context-specific instructions
    if (context.postType === 'question') {
        promptParts.push(
            "5. Provide a helpful answer that addresses the question directly",
            "6. Use a supportive and informative tone"
        );
    } else if (context.postType === 'announcement') {
        promptParts.push(
            "5. Show appropriate enthusiasm or interest",
            "6. Acknowledge the news/announcement specifically"
        );
    }

    // Add tone matching instructions
    if (context.tone === 'positive') {
        promptParts.push("7. Match the positive energy while staying authentic");
    } else if (context.tone === 'negative') {
        promptParts.push("7. Show empathy and understanding");
    }

    // Add style guidelines based on content
    if (context.hasHashtags) {
        promptParts.push("8. Consider including 1-2 relevant hashtags if appropriate");
    }
    if (context.hasEmojis) {
        promptParts.push("8. You may include 1-2 relevant emojis if they add value");
    }

    return promptParts.join('\n');
}

// Add function to get unique post identifier
async function getPostIdentifier(page: any, postSelector: string): Promise<string> {
    try {
        // Try to get post timestamp which usually contains the post URL
        const timestampSelector = `${postSelector} time[datetime]`;
        const timestamp = await page.$(timestampSelector);
        if (timestamp) {
            const href = await timestamp.evaluate((el: Element) => {
                const parent = el.closest('a');
                return parent ? parent.href : null;
            });
            if (href) return href;
        }

        // Fallback: Try to get post URL directly
        const linkSelector = `${postSelector} a[href*="/p/"]`;
        const link = await page.$(linkSelector);
        if (link) {
            const href = await link.evaluate((el: Element) => el.getAttribute('href'));
            if (href) return href;
        }

        // Last resort: Use a combination of author and caption as identifier
        const authorSelector = `${postSelector} a[href^="/"][href$="/"]`;
        const author = await page.$(authorSelector);
        const authorName = author ? await author.evaluate((el: Element) => el.textContent) : '';
        
        const captionSelector = `${postSelector} div.x9f619 span._ap3a div span._ap3a`;
        const captionElement = await page.$(captionSelector);
        const caption = captionElement ? 
            await captionElement.evaluate((el: HTMLElement) => el.innerText.slice(0, 50)) : '';
        
        return `${authorName}_${caption}`;
    } catch (error) {
        console.error('Error getting post identifier:', error);
        // If all methods fail, return a timestamp-based identifier as last resort
        return `fallback_${Date.now()}`;
    }
}

async function interactWithPosts(page: any) {
    let postIndex = 1;
    const maxPosts = 50;

    while (postIndex <= maxPosts) {
        try {
            const postSelector = `article:nth-of-type(${postIndex})`;

            // Check if the post exists
            if (!(await page.$(postSelector))) {
                console.log("No more posts found. Ending iteration...");
                return;
            }

            // Get post identifier early
            const postId = await getPostIdentifier(page, postSelector);

            // Check rate limits before liking
            if (rateLimiter.canLike()) {
                const likeButtonSelector = `${postSelector} svg[aria-label="Like"]`;
                const likeButton = await page.$(likeButtonSelector);
                const ariaLabel = await likeButton?.evaluate((el: Element) =>
                    el.getAttribute("aria-label")
                );

                if (ariaLabel === "Like") {
                    console.log(`Liking post ${postIndex}...`);
                    await likeButton.click();
                    await page.keyboard.press("Enter");
                    rateLimiter.incrementLikes();
                    console.log(`Post ${postIndex} liked. Remaining likes this hour: ${rateLimiter.getRemainingLikes()}`);
                } else if (ariaLabel === "Unlike") {
                    console.log(`Post ${postIndex} is already liked.`);
                }
            } else {
                console.log("Like rate limit reached. Skipping like action.");
            }

            // Extract and log the post caption
            const captionSelector = `${postSelector} div.x9f619 span._ap3a div span._ap3a`;
            const captionElement = await page.$(captionSelector);

            let caption = "";
            if (captionElement) {
                caption = await captionElement.evaluate((el: HTMLElement) => el.innerText);
                console.log(`Caption for post ${postIndex}: ${caption}`);
            }

            // Check if there is a '...more' link to expand the caption
            const moreLinkSelector = `${postSelector} div.x9f619 span._ap3a span div span.x1lliihq`;
            const moreLink = await page.$(moreLinkSelector);
            if (moreLink) {
                await moreLink.click();
                const expandedCaption = await captionElement.evaluate(
                    (el: HTMLElement) => el.innerText
                );
                caption = expandedCaption;
            }

            // Comment on the post if rate limit allows and haven't commented before
            if (rateLimiter.canComment() && !commentedPosts.has(postId)) {
                const commentBoxSelector = `${postSelector} textarea`;
                const commentBox = await page.$(commentBoxSelector);
                if (commentBox) {
                    // Check if we've already commented on this post
                    const existingComments = await page.$$(`${postSelector} ul li`);
                    let alreadyCommented = false;
                    
                    // Check the username in comments
                    for (const comment of existingComments) {
                        const username = await comment.$eval('a', (el: Element) => el.textContent);
                        if (username === IGusername) {
                            alreadyCommented = true;
                            commentedPosts.add(postId);
                            console.log(`Already commented on post ${postIndex}, skipping...`);
                            break;
                        }
                    }

                    if (!alreadyCommented) {
                        console.log(`Commenting on post ${postIndex}...`);
                        
                        // Update to only pass caption
                        const context = await analyzePostContext(caption);
                        
                        // Construct contextual prompt
                        const prompt = constructContextualPrompt(caption, context);
                        
                        const schema = getInstagramCommentSchema();
                        const result = await runAgent(schema, prompt);
                        const comment = result[0]?.comment;
                        await commentBox.type(comment);

                        const postButton = await page.evaluateHandle(() => {
                            const buttons = Array.from(document.querySelectorAll('div[role="button"]'));
                            return buttons.find(button => button.textContent === 'Post' && !button.hasAttribute('disabled'));
                        });

                        if (postButton) {
                            await postButton.click();
                            commentedPosts.add(postId);
                            rateLimiter.incrementComments();
                            console.log(`Post ${postIndex} commented. Remaining comments this hour: ${rateLimiter.getRemainingComments()}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error interacting with post:', error);
        }

        postIndex++;
        if (postIndex > maxPosts) {
            console.log("All posts interacted with. Ending iteration...");
            return;
        }
    }
}

// Remove the comment and fix the export
export default runInstagram;