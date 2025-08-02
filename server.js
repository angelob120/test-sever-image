const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Store browser instance
let browser = null;

// Initialize browser
async function initBrowser() {
    if (!browser) {
        console.log('🚀 Launching browser...');
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security'
            ]
        });
    }
    return browser;
}

// Extract images endpoint
app.post('/extract-images', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        console.log(`📄 Extracting images from: ${url}`);
        
        const browser = await initBrowser();
        const page = await browser.newPage();
        
        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Navigate with timeout
        await page.goto(url, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });

        // Wait for dynamic content
        await page.waitForTimeout(3000);

        // Scroll to load lazy images
        await scrollPageToLoadImages(page);

        // Extract images
        const imageData = await page.evaluate(() => {
            const images = [];
            
            // Method 1: Standard img tags
            const imgElements = document.querySelectorAll('img');
            imgElements.forEach((img, index) => {
                if (img.src && img.src.startsWith('http')) {
                    images.push({
                        src: img.src,
                        alt: img.alt || `image-${index}`,
                        type: 'img-tag',
                        width: img.naturalWidth || img.width || 0,
                        height: img.naturalHeight || img.height || 0
                    });
                }
            });

            // Method 2: Background images
            const allElements = document.querySelectorAll('*');
            allElements.forEach((element, index) => {
                const style = window.getComputedStyle(element);
                const bgImage = style.backgroundImage;
                
                if (bgImage && bgImage !== 'none' && bgImage.includes('url(')) {
                    const urlMatch = bgImage.match(/url\(["']?(.*?)["']?\)/);
                    if (urlMatch && urlMatch[1] && urlMatch[1].startsWith('http')) {
                        images.push({
                            src: urlMatch[1],
                            alt: `background-${index}`,
                            type: 'background-image',
                            element: element.tagName,
                            width: 0,
                            height: 0
                        });
                    }
                }
            });

            // Method 3: Picture elements and srcset
            const pictureElements = document.querySelectorAll('picture source, picture img, [srcset]');
            pictureElements.forEach((element, index) => {
                const srcset = element.srcset || element.src;
                if (srcset && srcset.includes('http')) {
                    // Handle srcset - take the highest quality URL
                    const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
                    const httpUrls = urls.filter(url => url.startsWith('http'));
                    
                    if (httpUrls.length > 0) {
                        images.push({
                            src: httpUrls[httpUrls.length - 1], // Take last (usually highest quality)
                            alt: `picture-${index}`,
                            type: 'picture-element',
                            width: 0,
                            height: 0
                        });
                    }
                }
            });

            // Method 4: Data attributes (lazy loading)
            const lazySelectors = '[data-src], [data-lazy-src], [data-original], [data-image], [data-bg]';
            const lazyImages = document.querySelectorAll(lazySelectors);
            lazyImages.forEach((element, index) => {
                const src = element.dataset.src || 
                           element.dataset.lazySrc || 
                           element.dataset.original ||
                           element.dataset.image ||
                           element.dataset.bg;
                           
                if (src && src.startsWith('http')) {
                    images.push({
                        src: src,
                        alt: `lazy-${index}`,
                        type: 'lazy-loading',
                        width: 0,
                        height: 0
                    });
                }
            });

            // Remove duplicates and filter out tiny images
            const uniqueImages = images.filter((img, index, self) => {
                const isDuplicate = index !== self.findIndex(i => i.src === img.src);
                const isTooSmall = (img.width > 0 && img.height > 0) && (img.width < 50 || img.height < 50);
                return !isDuplicate && !isTooSmall;
            });

            return uniqueImages;
        });

        await page.close();

        console.log(`✅ Found ${imageData.length} unique images`);
        
        res.json({
            success: true,
            images: imageData,
            count: imageData.length,
            url: url
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ 
            error: 'Failed to extract images',
            message: error.message 
        });
    }
});

// Helper function for scrolling
async function scrollPageToLoadImages(page) {
    const scrollSteps = 5;
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    
    for (let i = 0; i < scrollSteps; i++) {
        await page.evaluate((step, vh) => {
            window.scrollTo(0, step * vh);
        }, i, viewportHeight);
        
        await page.waitForTimeout(1000);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', browser: browser !== null });
});

// Serve the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🌟 Server running at http://localhost:${PORT}`);
    console.log('📂 Make sure to create a "public" folder with index.html');
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down gracefully...');
    if (browser) {
        await browser.close();
    }
    process.exit(0);
});

module.exports = app;