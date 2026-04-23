import fastify from 'fastify';
import { z } from 'zod';
import { renderLottieToWebP, initBrowser } from './renderer.js';

const app = fastify({ logger: true });

app.get('/health', async () => {
    return { status: 'ok' };
});

app.get('/render', async (request, reply) => {
    try {
        const { url } = z.object({ url: z.string().url() }).parse(request.query);
        
        console.log(`[Sticker Renderer] Starting render for ${url}`);
        
        // Fetch the JSON from the URL
        const response = await fetch(url);
        if (!response.ok) {
            return reply.code(400).send({ error: `Failed to fetch Lottie JSON: ${response.statusText}` });
        }
        
        const animationData = await response.json();
        
        const webpBuffer = await renderLottieToWebP(animationData);
        
        reply.header('Content-Type', 'image/webp');
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        return reply.send(webpBuffer);
    } catch (err: any) {
        app.log.error(err);
        return reply.code(500).send({ error: err.message || 'Internal Server Error' });
    }
});

const start = async () => {
    try {
        // Pre-warm the browser
        await initBrowser();
        
        const port = Number(process.env.PORT) || 3000;
        await app.listen({ port, host: '0.0.0.0' });
        console.log(`Sticker Renderer listening on port ${port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
