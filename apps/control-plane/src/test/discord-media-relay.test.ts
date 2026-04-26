import test from "node:test";
import assert from "node:assert/strict";
import { mapDiscordMediaToSkerryAttachments } from "../services/discord-bridge-service.js";

test("mapDiscordMediaToSkerryAttachments maps various media types correctly", () => {
    const input = [
        {
            url: "https://cdn.discordapp.com/attachments/123/456/image.gif",
            sourceUrl: "https://cdn.discordapp.com/attachments/123/456/image.gif",
            filename: "funny.gif"
        },
        {
            url: "https://cdn.discordapp.com/attachments/123/456/photo.jpg",
            sourceUrl: "https://cdn.discordapp.com/attachments/123/456/photo.jpg"
        },
        {
            url: "https://media.discordapp.net/stickers/789.png?size=240",
            sourceUrl: "https://discord.com/stickers/789.png",
            filename: "sticker.png",
            isSticker: true
        },
        {
            url: "https://cdn.discordapp.com/attachments/123/456/video.mp4",
            sourceUrl: "https://cdn.discordapp.com/attachments/123/456/video.mp4"
        }
    ];

    const results = mapDiscordMediaToSkerryAttachments(input);

    assert.strictEqual(results.length, 4);
    
    // GIF check — Discord-CDN-hosted .gif attachments are proxied as WebP
    // (format=webp) for faster animation; contentType reflects the proxied form.
    const r0 = results[0]!;
    assert.strictEqual(r0.contentType, "image/webp");
    assert.ok(r0.url.includes("media.discordapp.net"), "URL should be normalized to media proxy");
    assert.ok(r0.url.includes("format=webp"), "GIF should be proxied as webp");
    
    // JPG check
    const r1 = results[1]!;
    assert.strictEqual(r1.contentType, "image/jpeg");
    assert.ok(r1.url.includes("media.discordapp.net"), "URL should be normalized to media proxy");
    
    // Sticker check
    const r2 = results[2]!;
    assert.strictEqual(r2.contentType, "image/png");
    assert.ok(r2.isSticker, "Should be marked as sticker");
    
    // Video check
    const r3 = results[3]!;
    assert.strictEqual(r3.contentType, "video/mp4");
});

test("mapDiscordMediaToSkerryAttachments handles HEIC correctly", () => {
    const input = [
        {
            url: "https://cdn.discordapp.com/attachments/123/456/photo.heic",
            sourceUrl: "https://cdn.discordapp.com/attachments/123/456/photo.heic"
        }
    ];

    const results = mapDiscordMediaToSkerryAttachments(input);
    const r0 = results[0]!;
    assert.strictEqual(r0.contentType, "image/webp");
    assert.ok(r0.url.includes("format=webp"), "HEIC should be proxied as webp");
});
