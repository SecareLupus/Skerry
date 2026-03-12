import * as cheerio from "cheerio";
import { LinkEmbed } from "@skerry/shared";
import { logEvent } from "./observability-service.js";

export async function scrapeUrl(url: string): Promise<LinkEmbed | null> {
    try {
        // First check if it's a direct media link to avoid fetching large files
        if (/\.(jpeg|jpg|gif|png|webp|svg)$/i.test(url)) {
            return {
                url,
                title: url.split('/').pop() || "Image",
                imageUrl: url,
                type: "link" // We'll let the frontend handle it as an image ifimageUrl is present
            };
        }

        if (/\.(mp4|webm|mov)$/i.test(url)) {
            return {
                url,
                title: url.split('/').pop() || "Video",
                videoUrl: url,
                type: "video"
            };
        }

        const response = await fetch(url, {
            headers: {
                "User-Agent": "SkerryBot/1.0 (+https://github.com/SecareLupus/EscapeHatch)"
            },
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) return null;

        const contentType = response.headers.get("content-type");
        if (contentType?.startsWith("image/")) {
            return {
                url,
                title: url.split('/').pop() || "Image",
                imageUrl: url,
                type: "link"
            };
        }

        if (contentType?.startsWith("video/")) {
            return {
                url,
                title: url.split('/').pop() || "Video",
                videoUrl: url,
                type: "video"
            };
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const title = $('meta[property="og:title"]').attr("content") || $("title").text();
        const description = $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content");
        const image = $('meta[property="og:image"]').attr("content");
        const siteName = $('meta[property="og:site_name"]').attr("content");
        const videoUrl = $('meta[property="og:video:url"]').attr("content") || $('meta[property="og:video:secure_url"]').attr("content");

        // YouTube special handling
        let finalType: "link" | "video" = videoUrl ? "video" : "link";
        if (url.includes("youtube.com") || url.includes("youtu.be")) {
            finalType = "video";
        }

        if (!title && !description && !image) return null;

        return {
            url,
            title: title?.trim(),
            description: description?.trim(),
            imageUrl: image,
            siteName: siteName?.trim(),
            videoUrl: videoUrl,
            type: finalType
        };
    } catch (error) {
        logEvent("warn", "link_scrape_failed", { url, error: String(error) });
        return null;
    }
}

export async function processMessageContentForLinks(content: string): Promise<LinkEmbed[]> {
    const urlRegex = /https?:\/\/[^\s$.?#].[^\s]*/g;
    const matches = Array.from(content.matchAll(urlRegex));
    const urls = [...new Set(matches.map(m => m[0]))].slice(0, 3); // Limit to first 3 unique links

    if (urls.length === 0) return [];

    const embeds: LinkEmbed[] = [];
    for (const url of urls) {
        const embed = await scrapeUrl(url);
        if (embed) {
            embeds.push(embed);
        }
    }

    return embeds;
}
