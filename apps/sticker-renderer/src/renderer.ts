import { spawn } from 'child_process';
import path from 'path';
import axios from 'axios';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function initBrowser() {
    // No-op for rlottie
    return null;
}

export async function renderLottieToWebP(urlInput: string | any): Promise<Buffer> {
    const url = typeof urlInput === 'object' && urlInput !== null ? (urlInput.url || JSON.stringify(urlInput)) : urlInput;
    console.log(`[Sticker Renderer] Native render starting for ${url} (type: ${typeof urlInput})`);
    
    // 1. Fetch the Lottie JSON
    const { data: lottieJson } = await axios.get(url, { 
        responseType: 'text',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
            'Referer': 'https://discord.com/',
            'Accept': 'application/json'
        }
    });
    const lottieString = typeof lottieJson === 'string' ? lottieJson : JSON.stringify(lottieJson);
    const tempOutputFile = `/tmp/sticker-${Date.now()}.webp`;

    // 3. Find bridge path
    const bridgePath = path.join(__dirname, 'render.py');
    const bridgePathFallback = path.join(__dirname, '..', 'src', 'render.py');
    const bridgePathFallback2 = '/app/apps/sticker-renderer/src/render.py';
    
    let finalBridgePath = bridgePath;
    if (fs.existsSync(bridgePath)) {
        finalBridgePath = bridgePath;
    } else if (fs.existsSync(bridgePathFallback)) {
        finalBridgePath = bridgePathFallback;
    } else {
        finalBridgePath = bridgePathFallback2;
    }

    console.log(`[Sticker Renderer] Using bridge path: ${finalBridgePath} (exists: ${fs.existsSync(finalBridgePath)})`);
    
    // 3.1 Fetch Metadata first
    const getMetadata = async (): Promise<{ total_frames: number, framerate: number }> => {
        return new Promise((resolve, reject) => {
            const metaProcess = spawn('python3', [finalBridgePath, '--metadata']);
            let output = '';
            let error = '';
            metaProcess.stdout.on('data', (data) => output += data.toString());
            metaProcess.stderr.on('data', (data) => error += data.toString());
            metaProcess.on('close', (code) => {
                if (code !== 0) return reject(new Error(`Metadata failed: ${error}`));
                try {
                    resolve(JSON.parse(output.trim()));
                } catch (err) {
                    reject(new Error(`Failed to parse metadata: ${output}`));
                }
            });
            metaProcess.stdin.write(lottieString);
            metaProcess.stdin.end();
        });
    };

    const metadata = await getMetadata().catch(err => {
        console.warn(`[Sticker Renderer] Metadata fetch failed, defaulting to 30fps: ${err.message}`);
        return { total_frames: 60, framerate: 30 };
    });

    console.log(`[Sticker Renderer] Metadata: ${metadata.total_frames} frames @ ${metadata.framerate}fps`);

    // 3.2 Start FFmpeg with dynamic framerate
    const ffmpeg = spawn('ffmpeg', [
        '-y', // Overwrite
        '-f', 'rawvideo',
        '-pixel_format', 'bgra',
        '-video_size', '160x160',
        '-r', metadata.framerate.toString(),
        '-i', 'pipe:0',
        '-c:v', 'libwebp_anim', // Use animation-specific encoder
        '-lossless', '0', // Lossy for better compatibility
        '-q:v', '75',
        '-loop', '0',
        '-an',
        '-r', metadata.framerate.toString(), // Match output framerate
        '-vsync', '0',
        '-f', 'webp',
        tempOutputFile
    ]);

    // 4. Start the Native rlottie-python bridge for actual rendering
    const pythonBridge = spawn('python3', [finalBridgePath]);

    // Pipe Python output (raw frames) into FFmpeg input
    pythonBridge.stdout.pipe(ffmpeg.stdin);

    // Handle errors
    pythonBridge.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('Rendering')) {
            console.log(`[Sticker Renderer] Bridge: ${msg.trim()}`);
        } else {
            console.error(`[rlottie Error] ${msg.trim()}`);
        }
    });
    
    // Log FFmpeg progress
    ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('frame=')) {
            console.log(`[Sticker Renderer] FFmpeg: ${msg.trim()}`);
        }
    });

    // Send the Lottie JSON to the bridge
    pythonBridge.stdin.write(lottieString);
    pythonBridge.stdin.end();

    return new Promise((resolve, reject) => {
        let pythonError = '';
        pythonBridge.stderr.on('data', (data) => {
            if (!data.toString().includes('Rendering')) {
                pythonError += data.toString();
            }
        });

        pythonBridge.on('close', (code) => {
            if (code !== 0) {
                console.error(`[Sticker Renderer] Python bridge failed with code ${code}: ${pythonError}`);
                ffmpeg.kill();
                reject(new Error(`Python bridge failed (${code}): ${pythonError}`));
            }
        });

        ffmpeg.on('close', async (code) => {
            if (code === 0) {
                try {
                    const buffer = await fs.promises.readFile(tempOutputFile);
                    console.log(`[Sticker Renderer] Native render complete: ${buffer.length} bytes`);
                    // Cleanup
                    await fs.promises.unlink(tempOutputFile).catch(() => {});
                    resolve(buffer);
                } catch (err) {
                    reject(err);
                }
            } else {
                reject(new Error(`FFmpeg exited with code ${code}`));
            }
        });
        
        // Timeout safety
        setTimeout(() => {
            pythonBridge.kill();
            ffmpeg.kill();
            fs.promises.unlink(tempOutputFile).catch(() => {});
            reject(new Error('Render timed out'));
        }, 30000);
    });
}
