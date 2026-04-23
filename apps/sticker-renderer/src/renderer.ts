import { chromium, Browser } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

let browser: Browser | null = null;

export async function initBrowser() {
    if (!browser) {
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }
    return browser;
}

export async function renderLottieToWebP(animationData: any): Promise<Buffer> {
    const browser = await initBrowser();
    const context = await browser.newContext({
        viewport: { width: 512, height: 512 },
        deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lottie-render-'));
    
    try {
        const templatePath = path.resolve('src/template.html');
        await page.goto(`file://${templatePath}`);

        // Wait for lottie to be available (CDN might take a sec)
        await page.waitForFunction(() => typeof (window as any).lottie !== 'undefined', { timeout: 10000 });

        const info: any = await page.evaluate((data) => (window as any).renderLottie(data), animationData);
        const totalFrames = Math.min(info.totalFrames, 150); // Cap frames to avoid massive files
        const frameRate = info.frameRate || 30;

        console.log(`Rendering ${totalFrames} frames at ${frameRate}fps...`);

        for (let i = 0; i < totalFrames; i++) {
            await page.evaluate((f) => (window as any).goToFrame(f), i);
            await page.screenshot({
                path: path.join(tempDir, `frame_${i.toString().padStart(4, '0')}.png`),
                omitBackground: true
            });
        }

        const outputWebP = path.join(tempDir, 'output.webp');
        
        // Use ffmpeg to stitch frames into animated WebP
        // -framerate: input fps
        // -i: input pattern
        // -loop 0: infinite loop
        // -lossless 0: slightly compressed but much smaller
        // -preset default: standard optimization
        const ffmpegCmd = `ffmpeg -y -framerate ${frameRate} -i "${tempDir}/frame_%04d.png" -vcodec libwebp -lossless 0 -compression_level 6 -q:v 75 -loop 0 -an -vsync 0 "${outputWebP}"`;
        
        await execAsync(ffmpegCmd);

        const buffer = await fs.readFile(outputWebP);
        return buffer;
    } finally {
        await context.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}
