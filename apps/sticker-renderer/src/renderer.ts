import { spawn } from 'child_process';
import path from 'path';
import axios from 'axios';

export async function initBrowser() {
    // No-op for rlottie
    return null;
}

export async function renderLottieToWebP(url: string): Promise<Buffer> {
    console.log(`[Sticker Renderer] Native render starting for ${url}`);
    
    // 1. Fetch the Lottie JSON
    const { data: lottieJson } = await axios.get(url, { responseType: 'text' });
    const lottieString = typeof lottieJson === 'string' ? lottieJson : JSON.stringify(lottieJson);

    // 2. Start FFmpeg to receive raw BGRA frames
    const ffmpeg = spawn('ffmpeg', [
        '-f', 'rawvideo',
        '-vcodec', 'rawvideo',
        '-s', '160x160',
        '-pix_fmt', 'bgra',
        '-r', '30',
        '-i', '-',
        '-vcodec', 'libwebp',
        '-lossless', '1',
        '-loop', '0',
        '-an',
        '-f', 'webp',
        '-y',
        '-'
    ]);

    // 3. Start the Native rlottie-python bridge
    const pythonBridge = spawn('python3', [path.join(__dirname, 'render.py')]);

    const chunks: Buffer[] = [];
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    
    // Pipe Python output (raw frames) into FFmpeg input
    pythonBridge.stdout.pipe(ffmpeg.stdin);

    // Handle errors
    pythonBridge.stderr.on('data', (data) => console.error(`[rlottie Error] ${data}`));
    ffmpeg.stderr.on('data', (data) => {
        if (data.toString().includes('Error')) console.error(`[FFmpeg Error] ${data}`);
    });

    // Send the Lottie JSON to the bridge
    pythonBridge.stdin.write(lottieString);
    pythonBridge.stdin.end();

    return new Promise((resolve, reject) => {
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                const buffer = Buffer.concat(chunks);
                console.log(`[Sticker Renderer] Native render complete: ${buffer.length} bytes`);
                resolve(buffer);
            } else {
                reject(new Error(`FFmpeg exited with code ${code}`));
            }
        });
        
        // Timeout safety
        setTimeout(() => reject(new Error('Render timed out')), 15000);
    });
}
