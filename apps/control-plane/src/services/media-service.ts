import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import { config } from "../config.js";
import { withDb } from "../db/client.js";

function getFileExtension(contentType: string): string {
  const parts = contentType.split("/");
  return parts.length === 2 ? `.${parts[1]}` : "";
}

export async function uploadMedia(input: {
  serverId: string;
  contentType: string;
  base64Data: string;
}): Promise<{ url: string }> {
  const buffer = Buffer.from(input.base64Data, "base64");
  const filename = `${crypto.randomUUID().replaceAll("-", "")}${getFileExtension(input.contentType)}`;

  return withDb(async (db) => {
    // Check if the hub has an S3 config
    const row = await db.query<{ s3_config: any }>(
      `select hubs.s3_config from hubs
       join servers on servers.hub_id = hubs.id
       where servers.id = $1 limit 1`,
      [input.serverId]
    );

    const s3Config = row.rows[0]?.s3_config;

    if (s3Config) {
      // Upload to S3
      const s3Client = new S3Client({
        region: s3Config.region,
        endpoint: s3Config.endpoint,
        credentials: {
          accessKeyId: s3Config.accessKeyId,
          secretAccessKey: s3Config.secretAccessKey,
        },
        forcePathStyle: true // Often needed for local/minio testing
      });

      await s3Client.send(new PutObjectCommand({
        Bucket: s3Config.bucket,
        Key: filename,
        Body: buffer,
        ContentType: input.contentType,
      }));

      // Construct public URL
      let prefix = s3Config.publicUrlPrefix;
      if (!prefix.endsWith("/")) {
        prefix += "/";
      }
      return { url: `${prefix}${filename}` };
    } else {
      // Fallback to Synapse Media Repository
      if (!config.synapse.baseUrl || !config.synapse.accessToken) {
        throw new Error("Synapse configuration is missing and no S3 config is provided.");
      }

      const response = await fetch(`${config.synapse.baseUrl}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.synapse.accessToken}`,
          "Content-Type": input.contentType
        },
        body: buffer
      });

      if (!response.ok) {
        const errText = await response.text();
        const requestId = response.headers.get("x-request-id");
        const maskedToken = config.synapse.accessToken
          ? `${config.synapse.accessToken.slice(0, 4)}...${config.synapse.accessToken.slice(-4)}`
          : "missing";

        console.error(`Synapse upload failed [${response.status}]: ${errText}`, {
          requestId,
          baseUrl: config.synapse.baseUrl,
          tokenLength: config.synapse.accessToken?.length,
          maskedToken
        });

        throw new Error(`Synapse upload failed (${response.status}): ${errText} (request ${requestId ?? "unknown"})`);
      }

      const data = await response.json() as { content_uri: string };

      // We could return the mxc:// URI directly, but browsers can't render it.
      // We need to convert it to an HTTP URL using Synapse's download endpoint.
      // Format: mxc://server.name/mediaId
      const mxcUri = data.content_uri;
      if (mxcUri.startsWith("mxc://")) {
        const parts = mxcUri.slice("mxc://".length).split("/");
        if (parts.length === 2) {
          return { url: `${config.synapse.publicBaseUrl}/_matrix/media/v3/download/${parts[0]}/${parts[1]}` };
        }
      }

      // If it doesn't match expected format, return as is (might not render, but fails safe)
      return { url: data.content_uri };
    }
  });
}
