import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/errorMessage";
import {
  STORAGE_BUCKETS,
  BUCKET_MAX_BYTES,
  bucketAcceptsMime,
  buildObjectKey,
  type StorageBucket,
} from "@/lib/supabase/storage";

const BUCKET_VALUES = Object.values(STORAGE_BUCKETS) as [StorageBucket, ...StorageBucket[]];

const bodySchema = z.object({
  bucket: z.enum(BUCKET_VALUES),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  sizeBytes: z.number().int().nonnegative(),
});

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid request body", details: errorMessage(err, String(err)) },
      { status: 400 }
    );
  }

  const { bucket, filename, mimeType, sizeBytes } = body;

  if (sizeBytes > BUCKET_MAX_BYTES[bucket]) {
    return NextResponse.json(
      {
        error: `File too large for ${bucket} bucket`,
        max: BUCKET_MAX_BYTES[bucket],
        got: sizeBytes,
      },
      { status: 413 }
    );
  }

  if (!bucketAcceptsMime(bucket, mimeType)) {
    return NextResponse.json(
      { error: `MIME type ${mimeType} not allowed in ${bucket}` },
      { status: 415 }
    );
  }

  const objectKey = buildObjectKey(user.id, filename);

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(objectKey);

  if (error || !data) {
    return NextResponse.json(
      { error: `Failed to mint upload URL: ${error?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  // Return both the signed URL (for the client to PUT to) and the eventual
  // public URL (for the client to store in the row pointing at this file).
  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(objectKey);

  return NextResponse.json({
    bucket,
    objectKey,
    token: data.token,
    signedUrl: data.signedUrl,
    publicUrl: publicData.publicUrl,
  });
}
